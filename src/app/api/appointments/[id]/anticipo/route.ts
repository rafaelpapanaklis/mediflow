// /api/appointments/[id]/anticipo — pedir un anticipo desde la CITA (ws1-t3
// fase 1).
//
//   GET  → estado: sugerido, disponibilidad de Mercado Pago, si la cita ya
//          tiene factura (y su anticipo PENDING, si lo hay) o no (en cuyo
//          caso hace falta un concepto para poder pedirlo).
//   POST → { monto, horas?, enviarWhatsapp?, concepto? } → si la cita no
//          tiene factura, la crea con el concepto (del catálogo o el que
//          escriba recepción) por el MISMO camino que
//          POST /api/invoices/from-appointment, y luego pide el anticipo
//          sobre ella. El monto SIEMPRE se valida en el servidor.
//
// Multi-tenant: clinicId de la sesión.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { anticipoPanelDisponible, estadoAnticipoDeFactura, pedirAnticipoDeCita, sugeridoParaFactura } from "@/lib/anticipos/panel.server";
import { textoAnticipoPanel } from "@/lib/anticipos/mensaje-panel";
import { formatDateHuman, formatTimeHuman, toISODate } from "@/lib/whatsapp/bot/booking-parse";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";

export const dynamic = "force-dynamic";

async function comprobarCita(ctx: { clinicId: string; userId: string; role: any }, appointmentId: string) {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, startsAt: true, status: true },
  });
  if (!appt) return { error: NextResponse.json({ error: "Cita no encontrada" }, { status: 404 }) } as const;
  if (appt.patientId) {
    const denied = await assertPatientVisible(appt.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return { error: denied } as const;
  }
  return { appt } as const;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const chk = await comprobarCita(ctx, params.id);
  if ("error" in chk) return chk.error;

  const [disponible, invoice] = await Promise.all([
    anticipoPanelDisponible(ctx.clinicId),
    prisma.invoice.findUnique({
      where: { appointmentId: params.id },
      select: { id: true, total: true, paid: true, status: true },
    }),
  ]);

  if (!invoice) {
    const sugerido = await sugeridoParaFactura(ctx.clinicId, 0);
    return NextResponse.json({ disponible, tieneFactura: false, sugerido: null, horasSugeridas: sugerido.horas, pendiente: null });
  }

  const [sugerido, estado] = await Promise.all([
    sugeridoParaFactura(ctx.clinicId, invoice.total),
    estadoAnticipoDeFactura(ctx.clinicId, invoice.id),
  ]);

  return NextResponse.json({
    disponible,
    tieneFactura: true,
    invoiceId: invoice.id,
    sugerido: sugerido.monto,
    horasSugeridas: sugerido.horas,
    saldo: Math.max(0, invoice.total - invoice.paid),
    pendiente: estado.pendiente,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.deposit");
  if (denied) return denied;
  const chk = await comprobarCita(ctx, params.id);
  if ("error" in chk) return chk.error;

  const body = await req.json().catch(() => null);
  const monto = typeof body?.monto === "number" ? body.monto : NaN;
  const horas = typeof body?.horas === "number" ? body.horas : undefined;
  if (!Number.isFinite(monto)) {
    return NextResponse.json({ error: "El monto es obligatorio." }, { status: 400 });
  }
  const concepto = body?.concepto && typeof body.concepto === "object" ? body.concepto : undefined;

  const r = await pedirAnticipoDeCita({
    clinicId: ctx.clinicId,
    appointmentId: params.id,
    userId: ctx.userId,
    monto,
    horas,
    concepto: concepto
      ? {
          serviceId: typeof concepto.serviceId === "string" ? concepto.serviceId : undefined,
          description: typeof concepto.description === "string" ? concepto.description : undefined,
          unitPrice: typeof concepto.unitPrice === "number" ? concepto.unitPrice : undefined,
        }
      : undefined,
  });
  if (!r.ok || !r.deposit) {
    const status =
      r.error === "no_encontrada" ? 404 : r.error === "sin_mp" ? 409 : r.error === "sin_concepto" ? 400 : r.error === "mp_fallo" ? 502 : 400;
    return NextResponse.json({ error: r.motivo ?? r.error ?? "No se pudo pedir el anticipo.", code: r.error }, { status });
  }
  const { deposit } = r;

  if (!r.reutilizado) {
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "appointment",
      entityId: params.id,
      action: "update",
      before: { anticipo: null },
      after: { anticipo: { monto: deposit.amount, expiresAt: deposit.expiresAt, origen: "panel" } },
    });
  }

  const datos = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: {
      startsAt: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
      clinic: { select: { name: true, timezone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true } },
    },
  });
  const tz = datos?.clinic?.timezone || "America/Mexico_City";
  const paciente = datos?.patient ? `${datos.patient.firstName} ${datos.patient.lastName ?? ""}`.trim() : "Paciente";
  const texto = textoAnticipoPanel({
    paciente,
    clinica: datos?.clinic?.name ?? "la clínica",
    monto: deposit.amount,
    horas: horas ?? Math.max(1, Math.round((new Date(deposit.expiresAt).getTime() - Date.now()) / 3_600_000)),
    url: deposit.checkoutUrl,
    fechaHumana: datos ? formatDateHuman(toISODate(datos.startsAt, tz), tz) : null,
    hora: datos ? formatTimeHuman(datos.startsAt, tz) : null,
  });

  let whatsapp: { enviado: boolean; motivo?: string } = { enviado: false, motivo: "No se pidió enviar." };
  if (body?.enviarWhatsapp === true) {
    const puedeEnviar = denyIfMissingPermission(ctx, "whatsapp.send") === null;
    const phone = datos?.patient?.phone?.trim();
    if (!puedeEnviar) {
      whatsapp = { enviado: false, motivo: "No tienes permiso para enviar WhatsApp." };
    } else if (!phone) {
      whatsapp = { enviado: false, motivo: "El paciente no tiene teléfono registrado." };
    } else if (!datos?.clinic?.waConnected || !datos.clinic.waPhoneNumberId || !datos.clinic.waAccessToken) {
      whatsapp = { enviado: false, motivo: "WhatsApp no está conectado en esta clínica." };
    } else {
      const abierta = isWithin24hWindow(await lastInboundAtForPhone(ctx.clinicId, phone).catch(() => null), new Date());
      if (!abierta) {
        whatsapp = { enviado: false, motivo: "El paciente no ha escrito en las últimas 24 h: copia el texto y compártelo por otro medio." };
      } else {
        try {
          await sendWhatsAppLogged({
            clinic: {
              id: ctx.clinicId,
              waPhoneNumberId: datos.clinic.waPhoneNumberId,
              waAccessToken: datos.clinic.waAccessToken,
              waConnected: datos.clinic.waConnected,
              waTemplates: datos.clinic.waTemplates,
            },
            to: phone,
            body: texto,
            kind: "deposit_request",
          });
          whatsapp = { enviado: true };
        } catch (e) {
          whatsapp = { enviado: false, motivo: e instanceof WhatsAppBlockedError ? e.message : "No se pudo enviar el WhatsApp." };
        }
      }
    }
  }

  return NextResponse.json({ deposit, reutilizado: r.reutilizado, texto, whatsapp });
}

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
import { canalesAnticipoPanel, estadoAnticipoDeFactura, pedirAnticipoDeCita, sugeridoParaFactura } from "@/lib/anticipos/panel.server";
import { citaEsFuturaParaAnticipo, horasHastaVencer, type MetodoPedirAnticipo } from "@/lib/anticipos/core";
import { textoAnticipoPanel, textoAnticipoTransferencia } from "@/lib/anticipos/mensaje-panel";
import { leerDatosBancarios } from "@/lib/anticipos/datos-bancarios.server";
import { clabeAgrupada } from "@/lib/billing/spei-directo-core";
import { formatDateHuman, formatTimeHuman, toISODate } from "@/lib/whatsapp/bot/booking-parse";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { buildSolicitudAnticipoPdf } from "@/lib/anticipos/solicitud-pdf";
import { facturaOcupaLaCita } from "@/lib/invoices/cita-factura-cancelada";

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

  // Ajuste 2: SOLO citas futuras (SCHEDULED/CONFIRMED, inicio después de
  // ahora) — mismo criterio exacto que pedirAnticipoDeCita al pedirlo de
  // verdad, para que este GET nunca ofrezca un botón que el POST rechazaría.
  const citaElegible = citaEsFuturaParaAnticipo(chk.appt, new Date());
  const motivoCitaNoElegible = citaElegible
    ? null
    : "Esta cita ya pasó, ya se atendió o ya no está viva: el anticipo solo se puede pedir para citas futuras.";

  const [canales, invoice, clinica] = await Promise.all([
    canalesAnticipoPanel(ctx.clinicId),
    prisma.invoice.findUnique({
      where: { appointmentId: params.id },
      select: { id: true, total: true, paid: true, status: true },
    }).then((f) => (facturaOcupaLaCita(f) ? f : null)), // H1: una cancelada no es la de la cita
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true } }),
  ]);
  const disponible = canales.mercadopago || canales.transferencia;
  // ws1-t1 (M4): la zona de la CLÍNICA, no la del navegador.
  const zonaHoraria = clinica?.timezone || "America/Mexico_City";
  // H26 (revisión final, ws1-t4): el modal avisa ANTES si no hay WhatsApp
  // (mismo criterio que el POST), en vez de ofrecer «Pedir y enviar».
  const whatsapp = {
    conectado: !!(clinica?.waConnected && clinica.waPhoneNumberId && clinica.waAccessToken),
    puedeEnviar: denyIfMissingPermission(ctx, "whatsapp.send") === null,
  };

  if (!invoice) {
    const sugerido = await sugeridoParaFactura(ctx.clinicId, 0);
    return NextResponse.json({
      disponible,
      canales,
      tieneFactura: false,
      sugerido: null,
      horasSugeridas: sugerido.horas,
      pendiente: null,
      citaElegible,
      motivoCitaNoElegible,
      zonaHoraria,
      whatsapp,
    });
  }

  const [sugerido, estado] = await Promise.all([
    sugeridoParaFactura(ctx.clinicId, invoice.total, undefined, invoice.paid),
    estadoAnticipoDeFactura(ctx.clinicId, invoice.id),
  ]);

  return NextResponse.json({
    disponible,
    canales,
    tieneFactura: true,
    invoiceId: invoice.id,
    sugerido: sugerido.monto,
    horasSugeridas: sugerido.horas,
    saldo: Math.max(0, invoice.total - invoice.paid),
    pendiente: estado.pendiente,
    citaElegible,
    motivoCitaNoElegible,
    zonaHoraria,
    whatsapp,
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
  const metodo: MetodoPedirAnticipo = body?.metodo === "transferencia" ? "transferencia" : "mercadopago";
  const concepto = body?.concepto && typeof body.concepto === "object" ? body.concepto : undefined;

  const r = await pedirAnticipoDeCita({
    clinicId: ctx.clinicId,
    appointmentId: params.id,
    userId: ctx.userId,
    monto,
    horas,
    metodo,
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
      after: { anticipo: { monto: deposit.amount, expiresAt: deposit.expiresAt, origen: "panel", metodo: deposit.metodo } },
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
  // ws1-t1 (M1): SIEMPRE del `expiresAt` real, nunca del `horas` pedido — el
  // plazo se acota al inicio de la cita (pedirAnticipoDeCita), así que un
  // "24" pedido con la cita en 10 h vence en 10 h de verdad; el texto tiene
  // que decir eso, no lo que se pidió.
  const horasTexto = horasHastaVencer(deposit.expiresAt);
  const fechaHumana = datos ? formatDateHuman(toISODate(datos.startsAt, tz), tz) : null;
  const horaTexto = datos ? formatTimeHuman(datos.startsAt, tz) : null;

  // Transferencia (fase 2): texto y PDF con los datos bancarios de la sede.
  // Mercado Pago (fase 1): el texto de siempre, con el link.
  let texto: string;
  let pdfAttachment: WhatsAppOutboundAttachment | null = null;
  if (deposit.metodo === "transferencia") {
    const banco = await leerDatosBancarios(ctx.clinicId);
    if (!banco) {
      return NextResponse.json({ error: "Esta clínica no tiene datos bancarios cargados." }, { status: 409 });
    }
    texto = textoAnticipoTransferencia({
      paciente,
      clinica: datos?.clinic?.name ?? "la clínica",
      monto: deposit.amount,
      horas: horasTexto,
      banco: banco.banco,
      beneficiario: banco.beneficiario,
      clabeAgrupada: clabeAgrupada(banco.clabe),
      referencia: banco.referencia,
      fechaHumana,
      hora: horaTexto,
    });
    try {
      const pdf = await buildSolicitudAnticipoPdf({
        clinicId: ctx.clinicId,
        paciente,
        monto: deposit.amount,
        vence: new Date(deposit.expiresAt),
        banco: banco.banco,
        beneficiario: banco.beneficiario,
        clabe: banco.clabe,
        referencia: banco.referencia,
        fechaHumana,
        hora: horaTexto,
      });
      if (pdf) pdfAttachment = { buffer: pdf.buffer, filename: pdf.fileName, caption: "Solicitud de anticipo" };
    } catch (e) {
      console.error("[appointments/anticipo] no se pudo generar el PDF de la solicitud:", e);
    }
  } else {
    texto = textoAnticipoPanel({
      paciente,
      clinica: datos?.clinic?.name ?? "la clínica",
      monto: deposit.amount,
      horas: horasTexto,
      url: deposit.checkoutUrl ?? "",
      fechaHumana,
      hora: horaTexto,
    });
  }

  // ws1-t1 (B8): sin `motivo` cuando nadie pidió enviar — "no se pidió
  // enviar" no es un fallo que avisar, y el modal lo pintaba como si lo
  // fuera (caja de alerta) con solo pulsar "Pedir anticipo" a secas.
  let whatsapp: { enviado: boolean; motivo?: string } = { enviado: false };
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
        whatsapp = { enviado: false, motivo: "El paciente no ha escrito en las últimas 24 h: copia el texto (o el PDF) y compártelo por otro medio." };
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
            attachment: pdfAttachment,
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

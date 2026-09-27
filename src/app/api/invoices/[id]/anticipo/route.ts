// /api/invoices/[id]/anticipo — pedir un anticipo desde la FACTURA (ws1-t3
// fase 1).
//
//   GET  → estado: sugerido (de Configuración → Anticipos → panel), el
//          anticipo PENDING de esta factura si lo hay, y Total/Anticipo/
//          Pendiente para el detalle.
//   POST → { monto, horas?, enviarWhatsapp? } → crea (o reutiliza) el
//          anticipo y su link de Mercado Pago. El monto SIEMPRE se valida en
//          el servidor (10 ≤ monto ≤ total − pagado): lo que mande el cliente
//          es solo una propuesta.
//
// Multi-tenant: clinicId de la sesión; la factura se busca por esa clínica y
// se comprueba visibilidad del paciente antes de tocar nada.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { canalesAnticipoPanel, elegibilidadCitaDeInvoice, estadoAnticipoDeFactura, pedirAnticipoDeFactura, sugeridoParaFactura } from "@/lib/anticipos/panel.server";
import type { MetodoPedirAnticipo } from "@/lib/anticipos/core";
import { textoAnticipoPanel, textoAnticipoTransferencia } from "@/lib/anticipos/mensaje-panel";
import { leerDatosBancarios } from "@/lib/anticipos/datos-bancarios.server";
import { clabeAgrupada } from "@/lib/billing/spei-directo-core";
import { formatDateHuman, formatTimeHuman, toISODate } from "@/lib/whatsapp/bot/booking-parse";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { buildSolicitudAnticipoPdf } from "@/lib/anticipos/solicitud-pdf";

export const dynamic = "force-dynamic";

async function comprobarFactura(
  ctx: { clinicId: string; userId: string; role: any },
  invoiceId: string,
): Promise<{ error: Response } | { patientId: string | null }> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, clinicId: ctx.clinicId },
    select: { patientId: true },
  });
  if (!inv) return { error: NextResponse.json({ error: "Factura no encontrada" }, { status: 404 }) };
  if (inv.patientId) {
    const denied = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return { error: denied };
  }
  return { patientId: inv.patientId };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const chk = await comprobarFactura(ctx, params.id);
  if ("error" in chk) return chk.error;

  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { total: true, paid: true, status: true, appointmentId: true },
  });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  const [canales, sugerido, estado, elegibilidad] = await Promise.all([
    canalesAnticipoPanel(ctx.clinicId),
    sugeridoParaFactura(ctx.clinicId, inv.total),
    estadoAnticipoDeFactura(ctx.clinicId, params.id),
    elegibilidadCitaDeInvoice(ctx.clinicId, inv.appointmentId),
  ]);

  return NextResponse.json({
    disponible: canales.mercadopago || canales.transferencia,
    canales,
    sugerido: sugerido.monto,
    horasSugeridas: sugerido.horas,
    saldo: Math.max(0, inv.total - inv.paid),
    total: inv.total,
    pagado: inv.paid,
    anticipoPagado: estado.anticipoPagado,
    pendiente: estado.pendiente,
    // Ajuste 2: solo citas futuras (SCHEDULED/CONFIRMED, inicio después de
    // ahora). Sin cita ligada, siempre elegible.
    citaElegible: elegibilidad.elegible,
    motivoCitaNoElegible: elegibilidad.motivo,
    // QA t2 (fase 2): el botón que dispara este GET se decide por el
    // PERMISO real de la sesión, no por el rol ni por "sin mirar nada". El
    // cliente (invoice-detail-modal.tsx) esconde "Pedir anticipo"/"Registrar
    // anticipo recibido" con esto; el servidor los vuelve a exigir igual en
    // el POST correspondiente.
    puedeDepositar: denyIfMissingPermission(ctx, "billing.deposit") === null,
    puedeRegistrar: denyIfMissingPermission(ctx, "billing.charge") === null,
    puedeEnviarRecibo: denyIfMissingPermission(ctx, "whatsapp.send") === null,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Pedir un anticipo mueve dinero: key propia (ws1-t3), no "billing.charge"
  // — el doctor la tiene por default y billing.charge no.
  const denied = denyIfMissingPermission(ctx, "billing.deposit");
  if (denied) return denied;
  const chk = await comprobarFactura(ctx, params.id);
  if ("error" in chk) return chk.error;

  const body = await req.json().catch(() => null);
  const monto = typeof body?.monto === "number" ? body.monto : NaN;
  const horas = typeof body?.horas === "number" ? body.horas : undefined;
  if (!Number.isFinite(monto)) {
    return NextResponse.json({ error: "El monto es obligatorio." }, { status: 400 });
  }
  const metodo: MetodoPedirAnticipo = body?.metodo === "transferencia" ? "transferencia" : "mercadopago";

  const r = await pedirAnticipoDeFactura({ clinicId: ctx.clinicId, invoiceId: params.id, userId: ctx.userId, monto, horas, metodo });
  if (!r.ok || !r.deposit) {
    const status = r.error === "no_encontrada" ? 404 : r.error === "sin_mp" ? 409 : r.error === "mp_fallo" ? 502 : 400;
    return NextResponse.json({ error: r.motivo ?? r.error ?? "No se pudo pedir el anticipo.", code: r.error }, { status });
  }
  const { deposit } = r;

  if (!r.reutilizado) {
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "invoice",
      entityId: params.id,
      action: "update",
      before: { anticipo: null },
      after: { anticipo: { monto: deposit.amount, expiresAt: deposit.expiresAt, origen: "panel", metodo: deposit.metodo } },
    });
  }

  // Texto (siempre) + envío por WhatsApp (solo si lo piden y la ventana está
  // abierta): dentro de la ventana, texto libre y gratis, como hoy. Fuera de
  // ella no se intenta nada — ni plantilla, ni texto que Meta rechazaría — y
  // la pantalla ofrece «Copiar texto».
  const datos = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: {
      patient: { select: { firstName: true, lastName: true, phone: true } },
      appointment: { select: { startsAt: true } },
      clinic: { select: { name: true, timezone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true } },
    },
  });
  const tz = datos?.clinic?.timezone || "America/Mexico_City";
  const paciente = datos?.patient ? `${datos.patient.firstName} ${datos.patient.lastName ?? ""}`.trim() : "Paciente";
  const cita = datos?.appointment;
  const horasTexto = horas ?? Math.max(1, Math.round((new Date(deposit.expiresAt).getTime() - Date.now()) / 3_600_000));
  const fechaHumana = cita ? formatDateHuman(toISODate(cita.startsAt, tz), tz) : null;
  const horaTexto = cita ? formatTimeHuman(cita.startsAt, tz) : null;

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
      console.error("[invoices/anticipo] no se pudo generar el PDF de la solicitud:", e);
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

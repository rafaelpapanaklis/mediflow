// POST /api/invoices/[id]/send-whatsapp — aviso de saldo pendiente al paciente.
//
// Con la ventana de 24 h abierta sale como texto libre (resumen con folio,
// saldo y conceptos) + el comprobante PDF adjunto en el mismo hilo. Con la
// ventana cerrada, sendWhatsAppLogged resuelve la plantilla `payment_notice`
// (dc_aviso_saldo) o bloquea con un motivo legible que aquí se propaga tal
// cual al panel. El aviso dirige a pagar EN la clínica o por teléfono, por eso
// el teléfono de la clínica es obligatorio.
//
// ws1-t1 · Mercado Pago: con body `{ linkPago: true }` (y permiso de cobrar), el
// texto libre lleva además el link y el monto. Sin pedirlo, el aviso de siempre:
// es el que Sabina enseña antes de confirmar. La plantilla no lo admite: con la ventana
// cerrada el aviso sale sin link y la respuesta lo dice (`linkPago.enMensaje`
// = false) para que la pantalla ofrezca copiarlo.
//
// Multi-tenant: clinicId de la sesión; la factura se verifica contra él y las
// credenciales de WhatsApp son las de ESA clínica.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { CHARGEABLE_INVOICE_STATUSES } from "@/components/dashboard/billing/invoice-status";
import { buildInvoicePrintPdf } from "@/lib/invoices/print-pdf";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { buildPaymentNotice } from "@/lib/invoices/payment-notice";
import { linkParaEnviar } from "@/lib/factura-mp/envio.server";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { reservarAvisoDeCobro, ultimoAvisoDeCobroEnTelefonos } from "@/lib/whatsapp/aviso-cobro-tope";
import { horaDelAvisoPrevio } from "@/lib/invoices/aviso-del-dia";
import { pagoDelMesDeFactura } from "@/lib/invoices/pago-del-mes";
import { contactoDelResponsableDeLaFactura } from "@/lib/orthodontics/responsable-telefono-db";
import { destinatariosDeEnvio, esDestinoDeEnvio, type Destinatario } from "@/lib/invoices/destinatarios";

export const runtime = "nodejs"; // genera el PDF con @react-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cobrables SIN el borrador: un DRAFT todavía no es un saldo exigible y el
// aviso le cobraría al paciente algo que la clínica no ha confirmado.
const SENDABLE_STATUSES = CHARGEABLE_INVOICE_STATUSES.filter((s) => s !== "DRAFT");

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return denied;

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: {
      id: true, invoiceNumber: true, status: true, balance: true, total: true, paid: true, items: true, patientId: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
      clinic: {
        select: {
          id: true, name: true, phone: true, timezone: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true,
        },
      },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // El aviso lleva nombre y saldo del paciente: mismo gate de visibilidad que
  // el comprobante impreso.
  if (invoice.patientId) {
    const deniedPatient = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
  }

  if (!SENDABLE_STATUSES.includes(invoice.status as (typeof SENDABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: "Solo se puede enviar el aviso de una factura con saldo por cobrar (pendiente, parcial o vencida)." },
      { status: 409 },
    );
  }

  // ws1-t10: si el caso tiene RESPONSABLE DE PAGO con teléfono, el aviso va a él (y al paciente si se
  // pide o si el responsable no tiene); sin responsable, al paciente, como siempre. El aviso de «no
  // tiene teléfono» solo sale si ninguno de los dos tiene.
  const pedido = await req.json().catch(() => null);
  const destino = esDestinoDeEnvio(pedido?.destino) ? pedido.destino : "auto";
  const responsable = await contactoDelResponsableDeLaFactura(ctx.clinicId, invoice.id);
  const nombrePaciente = `${invoice.patient?.firstName ?? ""} ${invoice.patient?.lastName ?? ""}`.trim() || "Paciente";
  const patientPhone = invoice.patient?.phone?.trim() || null;
  const { destinatarios, sinContacto, motivo } = destinatariosDeEnvio({
    paciente: { nombre: nombrePaciente, telefono: patientPhone },
    responsable: responsable ? { nombre: responsable.nombre, parentesco: responsable.parentesco, telefono: responsable.telefono } : null,
    canal: "telefono",
    destino,
  });
  if (sinContacto) {
    return NextResponse.json(
      { error: responsable ? motivo : "El paciente no tiene teléfono registrado. Agrégalo en su expediente para poder avisarle por WhatsApp." },
      { status: 409 },
    );
  }

  const clinic = invoice.clinic;
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json(
      { error: "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp." },
      { status: 409 },
    );
  }

  // {{4}} de dc_aviso_saldo: sin teléfono de la clínica el aviso no tiene a
  // dónde dirigir el pago.
  const clinicPhone = clinic.phone?.trim();
  if (!clinicPhone) {
    return NextResponse.json(
      { error: "Falta el teléfono de la clínica: regístralo en Configuración → Clínica para poder enviar el aviso de saldo." },
      { status: 409 },
    );
  }

  // Link de Mercado Pago (ws1-t1). Nunca lanza: sin link, el aviso de siempre.

  // ws1-t4 #82 — un aviso de cobro por teléfono al día. El recordatorio de mensualidad
  // (Alertas) y este aviso salen con el mismo tipo `payment_notice`: mandar los dos el
  // mismo día era mandar dos cobros con montos distintos ($6,000 vencido y $30,000 de
  // saldo total). Se puede forzar a propósito con `forzar: true` (la pantalla lo pregunta).
  // El recordatorio de Alertas y los cobros automáticos salen al teléfono del RESPONSABLE de
  // pago; este aviso, al del paciente: se mira en los dos para que no le lleguen dos cobros
  // al mismo hogar.
  const telefonos = Array.from(new Set([...(patientPhone ? [patientPhone] : []), ...(responsable?.telefono ? [responsable.telefono] : [])]));
  const forzar = pedido?.forzar === true;

  /** ¿Ya salió un aviso de cobro en las últimas 24 h (manual, de Alertas o AUTOMÁTICO)? */
  const respuestaSiYaSalio = async (): Promise<NextResponse | null> => {
    const previo = await ultimoAvisoDeCobroEnTelefonos(ctx.clinicId, telefonos);
    if (!previo) return null;
    return NextResponse.json(
      {
        code: "AVISO_YA_ENVIADO",
        error: `Ya se le mandó un aviso de cobro en las últimas 24 h (${horaDelAvisoPrevio(previo, clinic.timezone)}). Para que no reciba mensajes con montos distintos, no se manda otro a menos que lo confirmes.`,
      },
      { status: 409 },
    );
  };
  if (!forzar) {
    const yaSalio = await respuestaSiYaSalio();
    if (yaSalio) return yaSalio;
  }

  // RESERVA antes de enviar: «comprobar y luego enviar» dejaba pasar dos clics o dos pestañas
  // a la vez. Ver src/lib/whatsapp/aviso-cobro-tope.ts.
  const reserva = await reservarAvisoDeCobro({ clinicId: ctx.clinicId, userId: ctx.userId, telefonos });
  if (!reserva.ok) {
    return NextResponse.json(
      { code: "AVISO_EN_CURSO", error: "Ya se está enviando un aviso de cobro a este teléfono. Espera unos segundos y revisa el Inbox antes de reintentar." },
      { status: 409 },
    );
  }
  try {
    // Otro envío pudo terminar entre la primera comprobación y la reserva.
    if (!forzar) {
      const yaSalio = await respuestaSiYaSalio();
      if (yaSalio) return yaSalio;
    }
  const { link, aviso: avisoLink } = await linkParaEnviar({
    clinicId: ctx.clinicId,
    invoiceId: invoice.id,
    userId: ctx.userId,
    pedido: pedido?.linkPago === true,
    puedeCobrar: denyIfMissingPermission(ctx, "billing.charge") === null,
  });
  // ¿Viajará el link? Solo en texto libre (ventana de 24 h abierta). Es el mismo
  // criterio con el que sendWhatsAppLogged elige entre texto y plantilla.
  const enMensaje = link
    ? isWithin24hWindow(await lastInboundAtForPhone(clinic.id, destinatarios[0].valor).catch(() => null), new Date())
    : false;

  // El texto sale de lib/invoices/payment-notice: Sabina enseña ESE MISMO texto en
  // su tarjeta antes de que alguien confirme el envío.
  // Factura a plazos: el texto dice «Tu pago de este mes es $X (saldo total $Y)».
  const pagoDelMes = await pagoDelMesDeFactura(prisma, {
    clinicId: ctx.clinicId, invoiceId: invoice.id, total: invoice.total, paid: invoice.paid, zonaHoraria: clinic.timezone,
  });

  // Comprobante PDF — solo sale con la ventana abierta (en modo plantilla el
  // helper lo ignora). Best-effort: sin PDF el aviso sigue valiendo.
  let attachment: WhatsAppOutboundAttachment | null = null;
  try {
    const pdf = await buildInvoicePrintPdf(invoice.id, ctx.clinicId);
    if (pdf) {
      attachment = { buffer: pdf.buffer, filename: pdf.fileName, caption: `Comprobante ${invoice.invoiceNumber}` };
    }
  } catch (e) {
    console.error("[invoices/send-whatsapp] no se pudo generar el comprobante PDF:", e);
  }

  const enviados: Destinatario[] = [];
  const fallos: { a: Destinatario; status: number; error: string }[] = [];
  for (const d of destinatarios) {
    const { body, templateParams } = buildPaymentNotice({
      // Al responsable se le saluda a él y se dice de quién es la nota.
      patient: d.rol === "responsable" ? { firstName: d.nombre, lastName: "" } : invoice.patient,
      aNombreDe: d.rol === "responsable" ? nombrePaciente : null,
      clinicName: clinic.name,
      clinicPhone,
      invoiceNumber: invoice.invoiceNumber,
      balance: invoice.balance,
      pagoDelMes,
      items: invoice.items,
      linkPago: link,
    });
    try {
      await sendWhatsAppLogged({
        clinic: {
          id: clinic.id,
          waPhoneNumberId: clinic.waPhoneNumberId,
          waAccessToken: clinic.waAccessToken,
          waConnected: clinic.waConnected,
          waTemplates: clinic.waTemplates,
        },
        to: d.valor,
        body,
        kind: "payment_notice",
        patientId: invoice.patientId ?? null,
        templateParams,
        attachment,
      });
      enviados.push(d);
    } catch (e) {
      // Bloqueo decidido ANTES de llamar a Meta (fuera de ventana sin plantilla
      // utilizable): el motivo ya viene en español para el panel.
      if (e instanceof WhatsAppBlockedError) {
        fallos.push({ a: d, status: 409, error: e.message });
      } else {
        console.error(`[invoices/send-whatsapp] fallo al enviar (${invoice.id}):`, e);
        fallos.push({ a: d, status: 502, error: e instanceof Error ? e.message : "No se pudo enviar el mensaje." });
      }
    }
  }
  // Nada salió: el motivo del primero, como antes. Salió a uno y a otro no: sale ok y se dice.
  if (enviados.length === 0) return NextResponse.json({ error: fallos[0].error }, { status: fallos[0].status });
  const parcial = fallos.length > 0
    ? `Salió a ${enviados.map((d) => d.nombre).join(" y ")}, pero no a ${fallos.map((f) => `${f.a.nombre} (${f.error})`).join(" ni a ")}.`
    : null;

  return NextResponse.json({
    ok: true,
    patientId: invoice.patientId ?? null,
    enviadoA: enviados.map((d) => ({ rol: d.rol, nombre: d.nombre })),
    avisoParcial: parcial,
    linkPago: link ? { ...link, enMensaje } : null,
    avisoLink: link && !enMensaje
      ? "El aviso salió con la plantilla de WhatsApp (el paciente no ha escrito en 24 h), que no admite el link. Cópialo y compártelo por otro medio."
      : avisoLink,
  });
  } finally {
    await reserva.liberar();
  }
}

// Mandarle el CFDI al paciente (ws1-t8, auditoría CFDI F-17).
//
//   GET  → qué se le puede mandar: el correo sugerido (el del receptor del CFDI, el del
//          responsable de pago o el del paciente) y por qué sale o no por WhatsApp.
//   POST { canal: "correo", correos } → Facturapi manda PDF + XML (POST /invoices/{id}/email).
//   POST { canal: "whatsapp" }        → con la ventana de 24 h abierta, el PDF adjunto y un enlace
//          firmado (7 días) para PDF y XML. Fuera de la ventana NO sale: la plantilla del CFDI
//          todavía no existe y la de la nota («Puedes pagarla…») diría algo falso.
//
// Multi-tenant: el CFDI se busca con el clinicId de la sesión. Permisos: ver la facturación y la
// ficha del paciente (como descargar el PDF), más «Crear facturas» para mandarlo, y «Enviar
// WhatsApp» para el WhatsApp. Cada envío queda en Movimientos.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import { getOrgApiKey, downloadInvoiceFileForOrg } from "@/lib/facturapi";
import { enviarCfdiPorCorreo, EnvioCorreoError } from "@/lib/cfdi/facturapi-extra.server";
import {
  normalizarCorreos, enmascararCorreo, enmascararTelefono, mensajeWhatsAppCfdi,
  motivoFueraDeVentana, cfdiSePuedeEnviar, textoBitacoraEnvio,
} from "@/lib/cfdi/envio";
import { rutaDescargaCfdi, caducidadDesde, origenPublico } from "@/lib/cfdi/enlace-descarga.server";
import { contactoDelResponsableDeLaFactura } from "@/lib/orthodontics/responsable-telefono-db";
import { destinatariosDeEnvio } from "@/lib/invoices/destinatarios";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: { cfdiId: string } };

/** El CFDI de la clínica de la sesión con lo necesario para mandarlo, o la respuesta de error. */
async function cargar(req: NextRequest, cfdiId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return { error: denied };
  if (typeof cfdiId !== "string" || !cfdiId) return { error: NextResponse.json({ error: "CFDI no encontrado" }, { status: 404 }) };

  const record = await prisma.cfdiRecord.findFirst({
    where: { id: cfdiId, clinicId: ctx.clinicId },
    select: { id: true, uuid: true, facturapiId: true, invoiceId: true, total: true, status: true, receptor: true },
  });
  if (!record?.facturapiId || !record.invoiceId) {
    return { error: NextResponse.json({ error: "CFDI no encontrado" }, { status: 404 }) };
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id: record.invoiceId, clinicId: ctx.clinicId },
    select: {
      id: true, invoiceNumber: true, patientId: true,
      patient: { select: { firstName: true, lastName: true, email: true, phone: true } },
      clinic: {
        select: {
          id: true, name: true, locale: true, facturApiOrgId: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true,
        },
      },
    },
  });
  if (!invoice) return { error: NextResponse.json({ error: "CFDI no encontrado" }, { status: 404 }) };
  // El CFDI lleva la identidad fiscal del paciente: misma regla que abrir su factura.
  const deniedPatient = await assertPatientVisible(invoice.patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (deniedPatient) return { error: deniedPatient };
  return { ctx, record, invoice };
}

function correoDelReceptor(receptor: unknown): string | null {
  const r = receptor as Record<string, unknown> | null;
  const e = typeof r?.email === "string" ? r.email.trim() : "";
  return e || null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const c = await cargar(req, params.cfdiId);
  if ("error" in c) return c.error;
  const { ctx, record, invoice } = c;
  const clinic = invoice.clinic;
  const en = (clinic.locale ?? "").startsWith("en");

  const responsable = await contactoDelResponsableDeLaFactura(ctx.clinicId, invoice.id).catch(() => null);
  const nombrePaciente = `${invoice.patient?.firstName ?? ""} ${invoice.patient?.lastName ?? ""}`.trim();
  const correo = correoDelReceptor(record.receptor) ?? responsable?.correo?.trim() ?? invoice.patient?.email?.trim() ?? null;

  let whatsapp: { modo: "text" | "blocked"; motivo: string | null; destino: string | null };
  if (!cfdiSePuedeEnviar(record.status)) {
    whatsapp = { modo: "blocked", motivo: en ? "This CFDI is not valid (cancelled or being cancelled)." : "Este CFDI ya no está vigente (cancelado o en cancelación).", destino: null };
  } else if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    whatsapp = { modo: "blocked", motivo: en ? "WhatsApp is not connected (Settings → WhatsApp)." : "WhatsApp no está conectado en esta clínica (Configuración → WhatsApp).", destino: null };
  } else if (denyIfMissingPermission(ctx, "whatsapp.send")) {
    whatsapp = { modo: "blocked", motivo: en ? "You don't have permission to send WhatsApp messages." : "No tienes permiso para enviar WhatsApp.", destino: null };
  } else {
    const { destinatarios, sinContacto, motivo } = destinatariosDeEnvio({
      paciente: { nombre: nombrePaciente || "Paciente", telefono: invoice.patient?.phone ?? null },
      responsable: responsable ? { nombre: responsable.nombre, parentesco: responsable.parentesco, telefono: responsable.telefono } : null,
      canal: "telefono",
    });
    if (sinContacto) {
      whatsapp = { modo: "blocked", motivo, destino: null };
    } else {
      const d = destinatarios[0];
      const ultimo = await lastInboundAtForPhone(clinic.id, d.valor).catch(() => null);
      whatsapp = isWithin24hWindow(ultimo, new Date())
        ? { modo: "text", motivo: null, destino: `${d.nombre} · ${enmascararTelefono(d.valor)}` }
        : { modo: "blocked", motivo: motivoFueraDeVentana(clinic.locale), destino: `${d.nombre} · ${enmascararTelefono(d.valor)}` };
    }
  }

  return NextResponse.json({
    uuid: record.uuid,
    vigente: cfdiSePuedeEnviar(record.status),
    correo,
    puedeEnviar: denyIfMissingPermission(ctx, "billing.create") === null,
    whatsapp,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const c = await cargar(req, params.cfdiId);
  if ("error" in c) return c.error;
  const { ctx, record, invoice } = c;
  const clinic = invoice.clinic;
  const en = (clinic.locale ?? "").startsWith("en");

  const deniedSend = denyIfMissingPermission(ctx, "billing.create");
  if (deniedSend) return deniedSend;

  const body = await req.json().catch(() => null);
  const canal = body?.canal === "whatsapp" ? "whatsapp" : body?.canal === "correo" ? "correo" : null;
  if (!canal) return NextResponse.json({ error: en ? "Choose email or WhatsApp." : "Elige correo o WhatsApp." }, { status: 400 });

  if (!cfdiSePuedeEnviar(record.status)) {
    return NextResponse.json({
      error: en ? "This CFDI is no longer valid (cancelled or being cancelled); it is not sent." : "Este CFDI ya no está vigente (cancelado o en cancelación); no se manda.",
      code: "CFDI_NO_VIGENTE",
    }, { status: 409 });
  }
  if (!clinic.facturApiOrgId) {
    return NextResponse.json({ error: en ? "Invoicing is not configured." : "La facturación no está configurada." }, { status: 409 });
  }

  // Doble clic / dos pestañas: un envío por CFDI y canal por minuto.
  if (!rateLimitKey(`cfdi-envio:${ctx.clinicId}:${record.id}:${canal}`, 1, 60_000)) {
    return NextResponse.json({
      error: en ? "It was just sent. Wait a minute before sending it again." : "Se acaba de mandar. Espera un minuto antes de volver a mandarlo.",
      code: "CFDI_ENVIO_RECIENTE",
    }, { status: 429 });
  }

  const nombrePaciente = `${invoice.patient?.firstName ?? ""} ${invoice.patient?.lastName ?? ""}`.trim();

  if (canal === "correo") {
    const n = normalizarCorreos(body?.correos ?? body?.correo, clinic.locale);
    if (!n.ok) return NextResponse.json({ error: n.error }, { status: 400 });
    try {
      const apiKey = await getOrgApiKey(clinic.facturApiOrgId);
      await enviarCfdiPorCorreo({ apiKey, facturapiId: record.facturapiId, correos: n.correos });
    } catch (e) {
      const status = e instanceof EnvioCorreoError ? (e.status >= 500 ? 502 : 400) : 502;
      console.error("[cfdi/enviar] correo:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo mandar el correo." }, { status });
    }
    const a = n.correos.map(enmascararCorreo).join(", ");
    await logMutation({
      texto: textoBitacoraEnvio("correo", a),
      req, clinicId: ctx.clinicId, userId: ctx.userId,
      entityType: "invoice", entityId: invoice.id, action: "update", patientId: invoice.patientId,
      before: { cfdiEnviado: null },
      after: { cfdiEnviado: { canal: "correo", a, uuid: record.uuid } },
    });
    return NextResponse.json({ ok: true, canal, enviadoA: n.correos });
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  const deniedWa = denyIfMissingPermission(ctx, "whatsapp.send");
  if (deniedWa) return deniedWa;
  if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json({ error: en ? "WhatsApp is not connected (Settings → WhatsApp)." : "WhatsApp no está conectado en esta clínica (Configuración → WhatsApp)." }, { status: 409 });
  }
  const origen = origenPublico();
  if (!origen) {
    return NextResponse.json({ error: "Falta NEXT_PUBLIC_APP_URL para armar el enlace de descarga." }, { status: 500 });
  }
  const responsable = await contactoDelResponsableDeLaFactura(ctx.clinicId, invoice.id).catch(() => null);
  const { destinatarios, sinContacto, motivo } = destinatariosDeEnvio({
    paciente: { nombre: nombrePaciente || "Paciente", telefono: invoice.patient?.phone ?? null },
    responsable: responsable ? { nombre: responsable.nombre, parentesco: responsable.parentesco, telefono: responsable.telefono } : null,
    canal: "telefono",
  });
  if (sinContacto) return NextResponse.json({ error: motivo }, { status: 409 });
  const d = destinatarios[0];

  // La ventana se mira AQUÍ antes de nada: fuera de ella no hay plantilla del CFDI y no se
  // manda nada. sendWhatsAppLogged la vuelve a mirar (tipo `system`, sin plantilla): si se
  // cerró en el último segundo, se bloquea igual en vez de caer a otra plantilla.
  const ultimo = await lastInboundAtForPhone(clinic.id, d.valor).catch(() => null);
  if (!isWithin24hWindow(ultimo, new Date())) {
    return NextResponse.json({ error: motivoFueraDeVentana(clinic.locale), code: "CFDI_WA_FUERA_DE_VENTANA" }, { status: 409 });
  }

  const caduca = caducidadDesde(new Date());
  const cuerpo = mensajeWhatsAppCfdi({
    nombre: d.nombre,
    clinica: clinic.name ?? "",
    folio: invoice.invoiceNumber ?? null,
    total: record.total,
    uuid: record.uuid,
    linkPdf: `${origen}${rutaDescargaCfdi(record.id, "pdf", caduca)}`,
    linkXml: `${origen}${rutaDescargaCfdi(record.id, "xml", caduca)}`,
    locale: clinic.locale,
  });

  // El PDF del CFDI adjunto en el mismo mensaje. Best-effort: sin él quedan los enlaces.
  let attachment: WhatsAppOutboundAttachment | null = null;
  try {
    const buf = await downloadInvoiceFileForOrg(clinic.facturApiOrgId, record.facturapiId, "pdf");
    attachment = { buffer: Buffer.from(buf), filename: `CFDI-${record.uuid}.pdf`, caption: `CFDI ${invoice.invoiceNumber ?? ""}`.trim() };
  } catch (e) {
    console.error("[cfdi/enviar] no se pudo bajar el PDF para adjuntarlo:", e instanceof Error ? e.message : e);
  }

  try {
    await sendWhatsAppLogged({
      clinic: {
        id: clinic.id, waPhoneNumberId: clinic.waPhoneNumberId, waAccessToken: clinic.waAccessToken,
        waConnected: clinic.waConnected, waTemplates: clinic.waTemplates,
      },
      to: d.valor,
      body: cuerpo,
      kind: "system",
      patientId: invoice.patientId ?? null,
      attachment,
    });
  } catch (e) {
    if (e instanceof WhatsAppBlockedError) {
      return NextResponse.json({ error: motivoFueraDeVentana(clinic.locale), code: "CFDI_WA_FUERA_DE_VENTANA" }, { status: 409 });
    }
    console.error("[cfdi/enviar] WhatsApp:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo enviar el WhatsApp." }, { status: 502 });
  }

  const a = `${d.nombre} · ${enmascararTelefono(d.valor)}`;
  await logMutation({
    texto: textoBitacoraEnvio("whatsapp", a),
    req, clinicId: ctx.clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: invoice.id, action: "update", patientId: invoice.patientId,
    before: { cfdiEnviado: null },
    after: { cfdiEnviado: { canal: "whatsapp", a, uuid: record.uuid, conPdf: attachment !== null } },
  });
  return NextResponse.json({ ok: true, canal, enviadoA: a, conPdf: attachment !== null });
}

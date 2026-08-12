// POST /api/quotes/[id]/send-whatsapp — manda al paciente la liga pública del
// presupuesto (/presupuesto/[acceptToken]).
//
// Si el presupuesto está en DRAFT (o EXPIRED, o le falta el token) primero se
// PRESENTA con la misma lógica del endpoint de status (lib/quotes/present):
// genera el token y asegura vigencia — no se duplica ninguna regla. Con la
// ventana de 24 h abierta sale texto libre con la liga + el PDF del
// presupuesto adjunto; cerrada, sendWhatsAppLogged resuelve la plantilla
// `quote_ready` (dc_presupuesto_listo) o bloquea con motivo legible.
//
// Multi-tenant: clinicId de la sesión; presupuesto y credenciales de WhatsApp
// verificados contra ESA clínica.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { presentQuote } from "@/lib/quotes/present";
import { buildQuotePdf } from "@/lib/quotes/quote-pdf";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";

export const runtime = "nodejs"; // genera el PDF con el stack de quote-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })
    .format(Number.isFinite(n) ? n : 0);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return denied;

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: {
      id: true, status: true, acceptToken: true, validUntil: true, patientId: true,
      folio: true, title: true, total: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
      clinic: {
        select: {
          id: true, name: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true,
        },
      },
    },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // La liga y el PDF llevan el nombre del paciente: misma visibilidad que el
  // resto de superficies de presupuestos.
  if (quote.patientId) {
    const deniedPatient = await assertPatientVisible(quote.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
  }

  if (quote.status === "ACCEPTED" || quote.status === "REJECTED") {
    return NextResponse.json(
      { error: "El presupuesto ya está cerrado: no hay nada que enviar al paciente." },
      { status: 409 },
    );
  }

  const patientPhone = quote.patient?.phone?.trim();
  if (!patientPhone) {
    return NextResponse.json(
      { error: "El paciente no tiene teléfono registrado. Agrégalo en su expediente para poder enviarle el presupuesto." },
      { status: 409 },
    );
  }

  const clinic = quote.clinic;
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json(
      { error: "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp." },
      { status: 409 },
    );
  }

  // DRAFT/EXPIRED (o un PRESENTED viejo sin token): presentar primero, con la
  // lógica compartida del endpoint de status. Genera la liga pública.
  let acceptToken = quote.acceptToken;
  if (quote.status !== "PRESENTED" || !acceptToken) {
    const presented = await presentQuote({
      current: quote,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
    });
    if (!presented.ok) {
      return NextResponse.json(
        { error: presented.error ?? "No se pudo presentar el presupuesto." },
        { status: presented.httpStatus ?? 409 },
      );
    }
    acceptToken = presented.quote?.acceptToken ?? null;
  }
  if (!acceptToken) {
    // No debería pasar (present siempre genera token); guardia por si acaso.
    return NextResponse.json({ error: "No se pudo generar la liga del presupuesto." }, { status: 500 });
  }

  // URL pública absoluta — mismo criterio que el resto de ligas públicas del
  // repo: NEXT_PUBLIC_APP_URL y, si falta, el origin del request.
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, "");
  const link = `${base}/presupuesto/${acceptToken}`;

  const patientName =
    `${quote.patient?.firstName ?? ""} ${quote.patient?.lastName ?? ""}`.trim() || "Paciente";
  const body =
    `Hola ${patientName}, en ${clinic.name} ya está listo tu presupuesto ` +
    `«${quote.title}» (${quote.folio}) por ${fmtMXN(Number(quote.total))}. ` +
    `Puedes verlo y aceptarlo aquí: ${link}. ` +
    `Cualquier duda respóndenos por este medio. ¡Gracias!`;

  // PDF del presupuesto — solo sale con la ventana abierta (en modo plantilla
  // el helper lo ignora). Best-effort: la liga es lo esencial.
  let attachment: WhatsAppOutboundAttachment | null = null;
  try {
    const pdf = await buildQuotePdf(quote.id, ctx.clinicId);
    if (pdf) {
      attachment = { buffer: pdf.buffer, filename: pdf.fileName, caption: `Presupuesto ${quote.folio}` };
    }
  } catch (e) {
    console.error("[quotes/send-whatsapp] no se pudo generar el PDF del presupuesto:", e);
  }

  try {
    await sendWhatsAppLogged({
      clinic: {
        id: clinic.id,
        waPhoneNumberId: clinic.waPhoneNumberId,
        waAccessToken: clinic.waAccessToken,
        waConnected: clinic.waConnected,
        waTemplates: clinic.waTemplates,
      },
      to: patientPhone,
      body,
      kind: "quote_ready",
      // Orden del spec dc_presupuesto_listo: paciente, clínica, liga.
      templateParams: [patientName, clinic.name, link],
      attachment,
    });
  } catch (e) {
    if (e instanceof WhatsAppBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : "No se pudo enviar el mensaje.";
    console.error(`[quotes/send-whatsapp] fallo al enviar (${quote.id}):`, e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ ok: true, patientId: quote.patientId ?? null });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { sendWhatsappMessage } from "@/lib/integrations/twilio-conversations";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { resolveWhatsappSendChannel, isWithin24hWindow } from "@/lib/inbox/send-core";
import { sendEmail } from "@/lib/email";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

/** Escapa el cuerpo del usuario antes de meterlo en el HTML del correo. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PostSchema = z.object({
  body: z.string().min(1).max(10_000),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().url(),
        mime: z.string(),
        size: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  isInternal: z.boolean().optional().default(false),
});

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const denied = denyIfMissingPermission(dbUser, "inbox.view");
    if (denied) return denied;

    const thread = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const messages = await prisma.inboxMessage.findMany({
      where: { threadId: params.id },
      orderBy: { sentAt: "asc" },
      select: {
        id: true,
        direction: true,
        body: true,
        attachments: true,
        sentAt: true,
        isInternal: true,
        externalId: true,
        sentBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[GET inbox/threads/:id/messages]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const denied = denyIfMissingPermission(dbUser, "inbox.send");
    if (denied) return denied;

    const body = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const thread = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      include: {
        clinic: {
          select: {
            // Meta Cloud API (stack real, mismo que webhook/cola/bot).
            waConnected: true,
            waPhoneNumberId: true,
            waAccessToken: true,
            // Twilio legacy (solo respaldo si no hay Meta).
            twilioAccountSid: true,
            twilioAuthToken: true,
            twilioWhatsappNumber: true,
          },
        },
        patient: { select: { id: true, phone: true, email: true } },
      },
    });
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const now = new Date();
    let externalId: string | null = null;
    let sendError: string | null = null;

    // Las notas internas nunca salen al canal externo: solo se guardan.
    // Para respuestas reales, entregamos según el canal del hilo.
    if (!parsed.data.isInternal) {
      if (thread.channel === "WHATSAPP") {
        const phone = thread.patient?.phone;
        if (!phone) {
          return NextResponse.json(
            { error: "missing_patient_phone" },
            { status: 400 },
          );
        }
        // Mismo stack que el webhook/cola/bot: Meta Cloud API si la clínica
        // está conectada por Meta; Twilio queda SOLO como respaldo legacy.
        const resolution = resolveWhatsappSendChannel(thread.clinic);
        if (resolution.channel === "none") {
          sendError = "whatsapp_not_connected";
        } else if (resolution.channel === "meta") {
          // Ventana de 24h de WhatsApp: con texto libre solo si el último IN
          // tiene <=24h. Si no, error claro en vez de intentar y fallar opaco.
          const lastIn = await prisma.inboxMessage.findFirst({
            where: { threadId: params.id, direction: "IN" },
            orderBy: { sentAt: "desc" },
            select: { sentAt: true },
          });
          if (!isWithin24hWindow(lastIn?.sentAt ?? null, now)) {
            sendError = "out_of_24h_window";
          } else {
            try {
              // sendWhatsAppMessage descifra el token internamente (igual que el
              // webhook). Lanza ante error → lo convertimos en sendError claro.
              const meta = await sendWhatsAppMessage(
                thread.clinic.waPhoneNumberId ?? "",
                thread.clinic.waAccessToken ?? "",
                phone,
                parsed.data.body,
              );
              externalId = meta?.messages?.[0]?.id ?? null;
            } catch (err) {
              sendError = err instanceof Error ? err.message : "send_failed";
            }
          }
        } else {
          // Twilio legacy (clínica con twilio* configurado y SIN Meta).
          const result = await sendWhatsappMessage(
            {
              accountSid: thread.clinic.twilioAccountSid ?? "",
              authToken: thread.clinic.twilioAuthToken ?? "",
              whatsappNumber: thread.clinic.twilioWhatsappNumber ?? "",
            },
            {
              to: phone,
              body: parsed.data.body,
              mediaUrls: parsed.data.attachments?.map((a) => a.url),
            },
          );
          if (!result.success) {
            sendError = result.error ?? "send_failed";
          } else {
            externalId = result.messageSid ?? null;
          }
        }
      } else if (thread.channel === "EMAIL") {
        // Email → Resend (infra existente en lib/email).
        const email = thread.patient?.email;
        if (!email) {
          return NextResponse.json(
            { error: "missing_patient_email" },
            { status: 400 },
          );
        }
        const baseSubject = thread.subject?.trim() || "Respuesta de tu clínica";
        const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
        const { delivered } = await sendEmail({
          to: email,
          subject,
          html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;white-space:pre-wrap;">${escapeHtml(parsed.data.body)}</div>`,
          text: parsed.data.body,
        });
        // sendEmail nunca tira: si no hay transporte (o falla), el mensaje
        // queda guardado pero marcado como no entregado.
        if (!delivered) sendError = "email_not_delivered";
      } else if (thread.channel === "PORTAL") {
        // Chat in-app del portal del paciente (WS2-T2): la "entrega" es la
        // propia DB — el paciente lo lee en /paciente/inbox por polling. Sin
        // canal externo ni sendError: para el staff es un envío normal.
      } else {
        // PORTAL_FORM, VALIDATION, REMINDER: sin ruta de entrega saliente.
        // Guardamos el mensaje y lo marcamos (no rompemos el flujo).
        sendError = "channel_no_delivery";
      }
    }

    const message = await prisma.inboxMessage.create({
      data: {
        threadId: params.id,
        direction: "OUT",
        body: parsed.data.body,
        attachments: parsed.data.attachments
          ? (parsed.data.attachments as unknown as object)
          : undefined,
        sentById: dbUser.id,
        sentAt: now,
        externalId,
        isInternal: parsed.data.isInternal,
      },
      select: {
        id: true,
        direction: true,
        body: true,
        attachments: true,
        sentAt: true,
        isInternal: true,
        externalId: true,
        sentBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Actualiza lastMessageAt. Si un humano responde un hilo de WhatsApp (mensaje
    // OUT real, no nota interna), pausamos el bot: estándar de inbox con bot para
    // que no pise la conversación que ya tomó una persona.
    const humanTookOver =
      !parsed.data.isInternal && thread.channel === "WHATSAPP";
    await prisma.inboxThread.update({
      where: { id: params.id },
      data: {
        lastMessageAt: now,
        ...(humanTookOver ? { botActive: false } : {}),
      },
    });

    return NextResponse.json(
      { message, sendError: sendError ?? undefined },
      { status: 201 },
    );
  } catch (err) {
    console.error("[POST inbox/threads/:id/messages]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

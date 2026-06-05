import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { sendWhatsappMessage } from "@/lib/integrations/twilio-conversations";
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
        // WhatsApp → Twilio (infra existente).
        const phone = thread.patient?.phone;
        if (!phone) {
          return NextResponse.json(
            { error: "missing_patient_phone" },
            { status: 400 },
          );
        }
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

    // Actualiza lastMessageAt del thread.
    await prisma.inboxThread.update({
      where: { id: params.id },
      data: { lastMessageAt: now },
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

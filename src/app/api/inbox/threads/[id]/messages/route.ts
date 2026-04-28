import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { sendWhatsappMessage } from "@/lib/integrations/twilio-conversations";

export const dynamic = "force-dynamic";

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

    // Si es WHATSAPP y NO es nota interna, intenta enviar via Twilio.
    if (thread.channel === "WHATSAPP" && !parsed.data.isInternal) {
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

// GET/POST /api/paciente/inbox/threads/[id]/messages
//
//  GET  → mensajes del hilo (excluye SIEMPRE isInternal) + serverTime (cursor).
//  POST → el paciente responde: crea InboxMessage direction=IN, isInternal=false,
//         sentById=null; marca el hilo UNREAD para que la clínica lo vea.
//
// Ownership estricto: el hilo debe ser canal PORTAL y su (clinicId, patientId)
// debe salir del MISMO link de la cuenta. Si no, 404 (no se distingue de "no
// existe" para no filtrar la existencia de hilos ajenos).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  PORTAL_CHANNEL,
  portalOwnsThread,
  portalMessageToDTO,
  type PortalMessagesResponse,
  type PortalSendResponse,
} from "@/lib/patient-portal/inbox";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

interface Params {
  params: { id: string };
}

const PostSchema = z.object({
  body: z.string().min(1).max(5_000),
});

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  body: true,
  attachments: true,
  sentAt: true,
} as const;

export async function GET(req: NextRequest, { params }: Params) {
  const limited = rateLimit(req, 60);
  if (limited) return limited;
  const serverTime = new Date();
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const thread = await prisma.inboxThread.findFirst({
      where: { id: params.id, channel: PORTAL_CHANNEL },
      select: { id: true, clinicId: true, patientId: true },
    });
    if (!thread || !portalOwnsThread(ctx.links, thread)) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }

    const rows = await prisma.inboxMessage.findMany({
      where: { threadId: thread.id, isInternal: false },
      orderBy: { sentAt: "asc" },
      take: 500,
      select: MESSAGE_SELECT,
    });

    const payload: PortalMessagesResponse = {
      messages: rows.map(portalMessageToDTO),
      serverTime: serverTime.toISOString(),
    };
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/paciente/inbox/threads/:id/messages]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const limited = rateLimit(req, 30);
  if (limited) return limited;
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const json = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400, headers: NO_STORE },
      );
    }

    const thread = await prisma.inboxThread.findFirst({
      where: { id: params.id, channel: PORTAL_CHANNEL },
      select: { id: true, clinicId: true, patientId: true },
    });
    if (!thread || !portalOwnsThread(ctx.links, thread)) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }

    const now = new Date();
    const created = await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        direction: "IN",
        body: parsed.data.body,
        isInternal: false,
        sentById: null,
        sentAt: now,
      },
      select: MESSAGE_SELECT,
    });

    // Reflota el hilo y lo marca no-leído para la clínica (su Inbox lo ve).
    await prisma.inboxThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now, status: "UNREAD" },
    });

    const payload: PortalSendResponse = { message: portalMessageToDTO(created) };
    return NextResponse.json(payload, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("[POST /api/paciente/inbox/threads/:id/messages]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}

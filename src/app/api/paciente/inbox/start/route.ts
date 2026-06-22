// POST /api/paciente/inbox/start { clinicId, subject?, body }
//
// Inicia (o reutiliza) la conversación PORTAL del paciente con una de sus
// clínicas y agrega el primer mensaje IN. clinicId DEBE pertenecer a la cuenta;
// el patientId sale del link (nunca del cliente). externalId = patientId fuerza
// "un hilo PORTAL por (clínica, paciente)" vía @@unique([clinicId,channel,externalId]).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  PORTAL_CHANNEL,
  PORTAL_DEFAULT_SUBJECT,
  portalPatientIdForClinic,
  type PortalStartResponse,
} from "@/lib/patient-portal/inbox";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

const StartSchema = z.object({
  clinicId: z.string().min(1),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5_000),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 15);
  if (limited) return limited;
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const json = await req.json().catch(() => null);
    const parsed = StartSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400, headers: NO_STORE },
      );
    }
    const { clinicId, subject, body } = parsed.data;

    // clinicId debe estar vinculado a la cuenta; tomamos el patientId del link.
    const patientId = portalPatientIdForClinic(ctx.links, clinicId);
    if (!patientId) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }

    const now = new Date();

    // Reutiliza cualquier hilo PORTAL de (clínica, paciente) — incluso uno que
    // haya creado el staff con externalId distinto — para no duplicar.
    let thread = await prisma.inboxThread.findFirst({
      where: { channel: PORTAL_CHANNEL, clinicId, patientId },
      select: { id: true },
    });

    if (!thread) {
      try {
        thread = await prisma.inboxThread.create({
          data: {
            clinicId,
            channel: PORTAL_CHANNEL,
            patientId,
            externalId: patientId,
            subject: subject?.trim() || PORTAL_DEFAULT_SUBJECT,
            status: "UNREAD",
            lastMessageAt: now,
          },
          select: { id: true },
        });
      } catch (e) {
        // Carrera: otro request lo creó entre el find y el create. Lo recuperamos.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          thread = await prisma.inboxThread.findFirst({
            where: { channel: PORTAL_CHANNEL, clinicId, patientId },
            select: { id: true },
          });
        } else {
          throw e;
        }
      }
    }

    if (!thread) {
      return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
    }

    await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        direction: "IN",
        body,
        isInternal: false,
        sentById: null,
        sentAt: now,
      },
      select: { id: true },
    });
    await prisma.inboxThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now, status: "UNREAD" },
    });

    const payload: PortalStartResponse = { threadId: thread.id };
    return NextResponse.json(payload, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("[POST /api/paciente/inbox/start]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}

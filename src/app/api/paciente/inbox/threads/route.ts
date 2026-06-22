// GET /api/paciente/inbox/threads — conversaciones del paciente (canal PORTAL).
//
// Devuelve SOLO campos seguros por hilo + la lista de clínicas vinculadas (para
// iniciar una conversación nueva). Tenancy 100% por ctx.links: nunca se acepta
// clinicId/patientId del cliente. JAMÁS expone assignedTo/botState/tags/status.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  PORTAL_CHANNEL,
  portalLinkPairs,
  portalPreview,
  type PortalClinicRef,
  type PortalThreadDTO,
  type PortalThreadsResponse,
} from "@/lib/patient-portal/inbox";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 60);
  if (limited) return limited;
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const pairs = portalLinkPairs(ctx.links);
    if (pairs.length === 0) {
      const empty: PortalThreadsResponse = { clinics: [], threads: [] };
      return NextResponse.json(empty, { headers: NO_STORE });
    }

    const clinicIds = Array.from(new Set(pairs.map((p) => p.clinicId)));
    const clinics = await prisma.clinic.findMany({
      where: { id: { in: clinicIds } },
      select: { id: true, name: true },
    });
    const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));
    const clinicRefs: PortalClinicRef[] = clinicIds.map((id) => ({
      clinicId: id,
      clinicName: clinicNameById.get(id) ?? "Tu clínica",
    }));

    const rows = await prisma.inboxThread.findMany({
      where: { channel: PORTAL_CHANNEL, OR: pairs },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      select: {
        id: true,
        clinicId: true,
        subject: true,
        lastMessageAt: true,
        // Último mensaje VISIBLE (excluye notas internas del staff) para la
        // vista previa + indicador "nuevo". take:1 desc → sin N+1.
        messages: {
          where: { isInternal: false },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: { body: true, direction: true },
        },
      },
    });

    const threads: PortalThreadDTO[] = rows.map((t) => {
      const last = t.messages[0];
      return {
        threadId: t.id,
        clinicId: t.clinicId,
        clinicName: clinicNameById.get(t.clinicId) ?? "Tu clínica",
        subject: t.subject,
        lastMessageAt: t.lastMessageAt.toISOString(),
        lastDirection: last ? (last.direction === "IN" ? "IN" : "OUT") : null,
        preview: last ? portalPreview(last.body) : null,
      };
    });

    const payload: PortalThreadsResponse = { clinics: clinicRefs, threads };
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/paciente/inbox/threads]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}

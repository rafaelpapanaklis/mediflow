// GET /api/paciente/inbox/since?ts=<ISO>&threadId=<id>
//
// Polling ligero del chat del paciente (réplica acotada de /api/inbox/since):
//   - messages: mensajes nuevos del hilo abierto (threadId) con sentAt > ts.
//   - threads:  hilos PORTAL del paciente con cambios (lastMessageAt|updatedAt) > ts.
//   - serverTime: reloj del servidor; el cliente lo usa como próximo ts.
//
// Tenancy idéntica al resto: alcance limitado a los pares (clinicId, patientId)
// de ctx.links. Sin ts válido devuelve solo el cursor (semilla).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  PORTAL_CHANNEL,
  portalLinkPairs,
  portalOwnsThread,
  portalPreview,
  portalMessageToDTO,
  type PortalMessageDTO,
  type PortalThreadDTO,
  type PortalSinceResponse,
} from "@/lib/patient-portal/inbox";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  body: true,
  attachments: true,
  sentAt: true,
} as const;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 60);
  if (limited) return limited;
  // Capturado ANTES de cualquier await: un mensaje insertado durante esta
  // petición tendrá sentAt >= serverTime y lo recogerá el próximo poll.
  const serverTime = new Date();
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const pairs = portalLinkPairs(ctx.links);
    if (pairs.length === 0) {
      const empty: PortalSinceResponse = {
        serverTime: serverTime.toISOString(),
        threads: [],
        messages: [],
      };
      return NextResponse.json(empty, { headers: NO_STORE });
    }

    const sp = req.nextUrl.searchParams;
    const tsRaw = sp.get("ts");
    const since = tsRaw ? new Date(tsRaw) : null;
    const hasSince = !!since && !Number.isNaN(since.getTime());

    // Mensajes nuevos del hilo abierto (si pertenece al paciente y es PORTAL).
    let messages: PortalMessageDTO[] = [];
    const threadId = sp.get("threadId");
    if (threadId && hasSince) {
      const owned = await prisma.inboxThread.findFirst({
        where: { id: threadId, channel: PORTAL_CHANNEL },
        select: { id: true, clinicId: true, patientId: true },
      });
      if (owned && portalOwnsThread(ctx.links, owned)) {
        const rows = await prisma.inboxMessage.findMany({
          where: { threadId, isInternal: false, sentAt: { gt: since! } },
          orderBy: { sentAt: "asc" },
          select: MESSAGE_SELECT,
        });
        messages = rows.map(portalMessageToDTO);
      }
    }

    // Hilos con novedades desde ts (vista previa + indicador "nuevo" del listado).
    let threads: PortalThreadDTO[] = [];
    if (hasSince) {
      const clinicIds = Array.from(new Set(pairs.map((p) => p.clinicId)));
      const clinics = await prisma.clinic.findMany({
        where: { id: { in: clinicIds } },
        select: { id: true, name: true },
      });
      const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));

      const rows = await prisma.inboxThread.findMany({
        where: {
          channel: PORTAL_CHANNEL,
          OR: pairs,
          AND: [{ OR: [{ lastMessageAt: { gt: since! } }, { updatedAt: { gt: since! } }] }],
        },
        orderBy: { lastMessageAt: "desc" },
        take: 100,
        select: {
          id: true,
          clinicId: true,
          subject: true,
          lastMessageAt: true,
          messages: {
            where: { isInternal: false },
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { body: true, direction: true },
          },
        },
      });
      threads = rows.map((t) => {
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
    }

    const payload: PortalSinceResponse = {
      serverTime: serverTime.toISOString(),
      threads,
      messages,
    };
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/paciente/inbox/since]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";

export const dynamic = "force-dynamic";

// Mismo helper self-contained que el resto de rutas del inbox (threads, [id],
// messages). El clinicId SIEMPRE sale de la cookie firmada, nunca del request:
// ese es el punto de aislamiento multi-tenant y aquí no se relaja.
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

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function isMissingTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "42P01";
}

/**
 * GET /api/inbox/since?ts=<ISO>&status=&channel=&assignedTo=&search=&patientId=&threadId=
 *
 * Endpoint LIGERO de polling para el inbox en tiempo real. Devuelve sólo lo que
 * cambió desde `ts`:
 *   - threads: hilos con un mensaje nuevo (lastMessageAt) o cambios de
 *     estado/asignación por otro usuario (updatedAt) posteriores a `ts`.
 *   - messages: mensajes nuevos del hilo abierto (threadId), si lo hay.
 *   - counts.byChannel: no-leídos por canal (clínica completa) para los badges.
 *   - serverTime: reloj del servidor; el cliente lo usa como próximo `ts`
 *     (evita clock skew cliente/servidor y huecos entre polls).
 *
 * Mismos filtros que GET /api/inbox/threads para que el merge en el cliente
 * respete la vista activa. Aislamiento por clínica garantizado en el servidor
 * (clinicId de getDbUser); nada del request puede ampliar el alcance.
 */
export async function GET(req: NextRequest) {
  // Capturado ANTES de cualquier await: es el cursor que devolvemos. Un mensaje
  // insertado durante esta petición tendrá sentAt >= serverTime y lo recogerá el
  // próximo poll (gt serverTime), así que no hay hueco.
  const serverTime = new Date();
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    const denied = denyIfMissingPermission(dbUser, "inbox.view");
    if (denied) return denied;

    const sp = req.nextUrl.searchParams;
    const tsRaw = sp.get("ts");
    const since = tsRaw ? new Date(tsRaw) : null;

    // Despertador perezoso de SNOOZED (igual que el listado): un hilo pospuesto
    // cuyo tiempo ya pasó vuelve a UNREAD y reaparece solo durante el polling.
    await prisma.inboxThread.updateMany({
      where: { clinicId: dbUser.clinicId, status: "SNOOZED", snoozedUntil: { lte: serverTime } },
      data: { status: "UNREAD", snoozedUntil: null },
    });

    // Counts de no-leídos por canal (clínica completa): barato y mantiene vivos
    // los badges del sidebar aunque otro usuario lea/llegue un mensaje.
    const channelCounts = await prisma.inboxThread.groupBy({
      by: ["channel"],
      where: { clinicId: dbUser.clinicId, status: "UNREAD" },
      _count: { _all: true },
    });
    const counts = {
      byChannel: Object.fromEntries(
        channelCounts.map((c) => [c.channel, c._count._all]),
      ) as Record<string, number>,
    };

    // Sin `ts` válido devolvemos sólo cursor + counts (semilla). No mandamos todo
    // el inbox: el cliente ya lo cargó con /api/inbox/threads.
    if (!since || Number.isNaN(since.getTime())) {
      return NextResponse.json({
        serverTime: serverTime.toISOString(),
        threads: [],
        messages: [],
        counts,
      });
    }

    // Filtros idénticos al listado. El OR de búsqueda y el OR de "lo nuevo" se
    // combinan con AND para que no se pisen entre sí.
    const where: Prisma.InboxThreadWhereInput = { clinicId: dbUser.clinicId };
    const status = sp.get("status");
    if (status && ["UNREAD", "READ", "ARCHIVED", "SNOOZED"].includes(status)) {
      where.status = status as "UNREAD" | "READ" | "ARCHIVED" | "SNOOZED";
    }
    const channel = sp.get("channel");
    if (channel && ["WHATSAPP", "EMAIL", "PORTAL_FORM", "VALIDATION", "REMINDER", "PORTAL"].includes(channel)) {
      where.channel = channel as "WHATSAPP" | "EMAIL" | "PORTAL_FORM" | "VALIDATION" | "REMINDER" | "PORTAL";
    }
    const assignedTo = sp.get("assignedTo");
    if (assignedTo === "me") where.assignedToId = dbUser.id;
    else if (assignedTo === "unassigned") where.assignedToId = null;
    else if (assignedTo) where.assignedToId = assignedTo;
    const patientId = sp.get("patientId");
    if (patientId) where.patientId = patientId;

    const andClauses: Prisma.InboxThreadWhereInput[] = [];
    const search = sp.get("search");
    if (search && search.trim().length > 0) {
      andClauses.push({
        OR: [
          { subject: { contains: search, mode: "insensitive" } },
          { patient: { firstName: { contains: search, mode: "insensitive" } } },
          { patient: { lastName: { contains: search, mode: "insensitive" } } },
        ],
      });
    }
    andClauses.push({
      OR: [{ lastMessageAt: { gt: since } }, { updatedAt: { gt: since } }],
    });
    // Visibilidad por paciente: mismo filtro que GET /api/inbox/threads. Va en
    // AND (nunca OR) y con patientNullable para que los hilos sin paciente
    // (WhatsApp/EMAIL sin ligar) sigan visibles.
    andClauses.push(
      ...relatedPatientVisibilityAnd(
        { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId },
        { patientNullable: true },
      ),
    );
    where.AND = andClauses;

    const threads = await prisma.inboxThread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      // Tope alto: en una ventana de 5s es imposible superarlo. Tras una pestaña
      // mucho tiempo oculta sí podría truncar; la reconciliación periódica del
      // cliente (recarga en duro cada ~30s) sana esa staleness.
      take: 200,
      select: {
        id: true,
        channel: true,
        subject: true,
        status: true,
        assignedToId: true,
        snoozedUntil: true,
        lastMessageAt: true,
        tags: true,
        externalId: true,
        botActive: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { messages: true } },
      },
    });

    // Mensajes nuevos del hilo abierto. Verificamos pertenencia a la clínica
    // ANTES de leer mensajes: sin esta comprobación un threadId ajeno filtraría
    // datos de otra clínica.
    let messages: unknown[] = [];
    const threadId = sp.get("threadId");
    if (threadId) {
      const owned = await prisma.inboxThread.findFirst({
        where: {
          id: threadId,
          clinicId: dbUser.clinicId,
          // Visibilidad: si el hilo es de un paciente restringido que este usuario
          // no puede ver, owned=null y NO se sirven sus mensajes. El listado ya
          // filtra, pero ?threadId=<restringido>&ts= los entregaba (IDOR).
          // patientNullable: los hilos sin paciente (WhatsApp/EMAIL) siguen ok.
          AND: relatedPatientVisibilityAnd(
            { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId },
            { patientNullable: true },
          ),
        },
        select: { id: true },
      });
      if (owned) {
        messages = await prisma.inboxMessage.findMany({
          where: { threadId, sentAt: { gt: since } },
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
      }
    }

    return NextResponse.json({
      serverTime: serverTime.toISOString(),
      threads,
      messages,
      counts,
    });
  } catch (err) {
    if (isMissingTable(err)) {
      return jsonError("schema_not_migrated", 503);
    }
    console.error("[GET /api/inbox/since]", err);
    return jsonError("internal_error", 500, {
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}

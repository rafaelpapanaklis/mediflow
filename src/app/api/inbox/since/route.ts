import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd, canViewPatient } from "@/lib/patient-visibility";
import { resolvePatientThreadScope, patientThreadWhere } from "@/lib/inbox/patient-threads";

export const dynamic = "force-dynamic";

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí (clinicId SIEMPRE de la
// cookie firmada, nunca del request), pero aplicando el gate de plan vencido
// que las copias locales se saltaban. ctx.user es la fila User (include
// clinic) con permissionsOverride normalizado.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
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
/**
 * Ventana en la que un mensaje del hilo abierto se reenvía en cada poll SOLO
 * para refrescar su estado de entrega. Meta confirma (o falla) en segundos o
 * pocos minutos; 30 min da margen de sobra sin arrastrar el historial entero.
 */
const RECENT_DELIVERY_MS = 30 * 60 * 1000;

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

    const andClauses: Prisma.InboxThreadWhereInput[] = [];

    // Filtro por paciente: MISMO criterio que GET /api/inbox/threads (el hilo
    // puede estar huérfano y corresponderle solo por teléfono), pero SIN
    // reparar — este endpoint corre cada 5 s y no tiene por qué escribir: para
    // entonces el GET de la lista ya enlazó lo que fuera inequívoco. Se aplica
    // igual para que un hilo que siga huérfano (caso ambiguo: el número lo
    // comparten dos pacientes) no desaparezca de la vista entre polls.
    const patientId = sp.get("patientId");
    if (patientId) {
      const canView = await canViewPatient(patientId, {
        userId: dbUser.id,
        role: dbUser.role,
        clinicId: dbUser.clinicId,
      });
      if (!canView) {
        // Sin visibilidad, filtro ESTRICTO por el enlace: nada que resolver por
        // teléfono para quien no puede ver al paciente. No devolvemos error —
        // el poll no debe romperse; el resultado vacío ya es la respuesta.
        andClauses.push({ patientId });
      } else {
        const scope = await resolvePatientThreadScope(dbUser.clinicId, patientId, {
          repair: false,
        });
        andClauses.push(patientThreadWhere(patientId, scope.extraThreadIds));
      }
    }

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
          where: {
            threadId,
            OR: [
              { sentAt: { gt: since } },
              // Cuando Meta confirma la entrega (o el fallo) de un mensaje NO
              // se mueve `sentAt` —la tabla no tiene updatedAt—, así que el
              // incremental por sentAt jamás lo volvería a mandar y la palomita
              // se quedaría congelada en el hilo que está abierto. Se reenvían
              // los recientes que YA tienen estado; el merge del cliente
              // parchea por id, así que reenviar de más no duplica nada.
              {
                sentAt: { gt: new Date(Date.now() - RECENT_DELIVERY_MS) },
                deliveryStatus: { not: null },
              },
            ],
          },
          orderBy: { sentAt: "asc" },
          select: {
            id: true,
            direction: true,
            body: true,
            attachments: true,
            sentAt: true,
            isInternal: true,
            externalId: true,
            deliveryStatus: true,
            deliveredAt: true,
            readAt: true,
            errorCode: true,
            errorTitle: true,
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

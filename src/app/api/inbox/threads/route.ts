import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { DEFAULT_TZ, calendarDayISO } from "@/lib/agenda/date-ranges";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";

export const dynamic = "force-dynamic";

const STATUS = z.enum(["UNREAD", "READ", "ARCHIVED", "SNOOZED"]);
const CHANNEL = z.enum(["WHATSAPP", "EMAIL", "PORTAL_FORM", "VALIDATION", "REMINDER", "PORTAL"]);

const CreateSchema = z.object({
  channel: CHANNEL,
  patientId: z.string().min(1).optional(),
  subject: z.string().min(1).max(200),
  initialMessage: z.string().min(1).max(10_000).optional(),
  externalId: z.string().optional(),
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

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function isMissingTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "42P01";
}

/** GET /api/inbox/threads?status=&channel=&assignedTo=&search= */
export async function GET(req: NextRequest) {
  // Cursor para el polling de /api/inbox/since: capturado al inicio para no
  // perder mensajes que entren durante esta petición. El cliente lo guarda y lo
  // manda como ?ts= en el siguiente poll (evita clock skew cliente/servidor).
  const serverTime = new Date();
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    const denied = denyIfMissingPermission(dbUser, "inbox.view");
    if (denied) return denied;

    // Despertador perezoso (sin cron): los hilos SNOOZED cuya hora ya pasó
    // vuelven a Inbox (UNREAD) al listar. Así un snooze a 1 min reaparece solo.
    await prisma.inboxThread.updateMany({
      where: { clinicId: dbUser.clinicId, status: "SNOOZED", snoozedUntil: { lte: new Date() } },
      data: { status: "UNREAD", snoozedUntil: null },
    });

    const sp = req.nextUrl.searchParams;
    // Visibilidad por paciente: los hilos de un paciente restringido solo los
    // ve quien está en su lista (+ admins). Los hilos SIN paciente se ven
    // siempre. Compartido entre la lista y las stats (?include=stats) para que
    // ambas cuenten exactamente lo que este usuario puede ver.
    const visibilityAnd = relatedPatientVisibilityAnd(
      { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId },
      { patientNullable: true },
    );
    const where: Prisma.InboxThreadWhereInput = {
      clinicId: dbUser.clinicId,
      // Va en AND porque `where.OR` lo ocupa la búsqueda por texto de más
      // abajo — meterlo ahí lo volvería permisivo en vez de restrictivo.
      ...(visibilityAnd.length ? { AND: visibilityAnd } : {}),
    };
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

    const search = sp.get("search");
    if (search && search.trim().length > 0) {
      where.OR = [
        { subject: { contains: search, mode: "insensitive" } },
        { patient: { firstName: { contains: search, mode: "insensitive" } } },
        { patient: { lastName: { contains: search, mode: "insensitive" } } },
      ];
    }

    const patientId = sp.get("patientId");
    if (patientId) where.patientId = patientId;

    const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10) || 100, 200);

    const threads = await prisma.inboxThread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: limit,
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
        // Último mensaje visible (no nota interna) para el preview de la
        // lista. Prisma resuelve el take:1 por hilo en batch — no hay N+1.
        messages: {
          where: { isInternal: false },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: { direction: true, sentAt: true, body: true },
        },
      },
    });

    // lastInboundAt (último mensaje IN por hilo) en UNA query agregada: el
    // include de arriba no puede filtrar la misma relación dos veces.
    const threadIds = threads.map((t) => t.id);
    const inboundMax = threadIds.length
      ? await prisma.inboxMessage.groupBy({
          by: ["threadId"],
          where: { threadId: { in: threadIds }, direction: "IN" },
          _max: { sentAt: true },
        })
      : [];
    const lastInboundByThread = new Map<string, Date | null>();
    inboundMax.forEach((g) => lastInboundByThread.set(g.threadId, g._max.sentAt));

    // Shape retrocompatible: los campos de siempre + lastMessage/lastInboundAt.
    // El array crudo `messages` (take:1) no se expone al cliente.
    const threadsPayload = threads.map(({ messages, ...t }) => {
      const last = messages[0];
      return {
        ...t,
        lastMessage: last
          ? {
              direction: last.direction,
              sentAt: last.sentAt,
              excerpt: last.body.slice(0, 140),
              isInternal: false,
            }
          : null,
        lastInboundAt: lastInboundByThread.get(t.id) ?? null,
      };
    });

    // Counts agregados por canal + status para los folders del sidebar.
    const channelCounts = await prisma.inboxThread.groupBy({
      by: ["channel"],
      where: { clinicId: dbUser.clinicId, status: "UNREAD" },
      _count: { _all: true },
    });
    const counts = {
      total: threads.length,
      byChannel: Object.fromEntries(
        channelCounts.map((c) => [c.channel, c._count._all]),
      ) as Record<string, number>,
    };

    // Stats para el header del rediseño — opt-in (?include=stats) para no
    // encarecer el polling actual. Globales por clínica (ignoran los filtros
    // de la lista) y con la MISMA visibilidad por paciente que la lista.
    let stats:
      | { waitingOver20m: number; resolvedToday: number; botAuto: number }
      | undefined;
    if ((sp.get("include") ?? "").split(",").map((s) => s.trim()).includes("stats")) {
      const twentyMinAgo = new Date(serverTime.getTime() - 20 * 60 * 1000);
      // "Hoy" = día calendario en la tz de la clínica (mismos helpers que la
      // agenda). resolvedToday usa el criterio simple updatedAt del ARCHIVED
      // (no hay resolvedAt dedicado y no tocamos schema).
      const clinic = await prisma.clinic.findUnique({
        where: { id: dbUser.clinicId },
        select: { timezone: true },
      });
      const tz = clinic?.timezone && clinic.timezone.length > 0 ? clinic.timezone : DEFAULT_TZ;
      const startOfToday = tzLocalToUtc(
        calendarDayISO(serverTime.toISOString(), tz), 0, 0, tz,
      );
      const [openThreads, resolvedToday, botAuto] = await Promise.all([
        prisma.inboxThread.findMany({
          where: {
            clinicId: dbUser.clinicId,
            status: { in: ["UNREAD", "READ"] },
            ...(visibilityAnd.length ? { AND: visibilityAnd } : {}),
          },
          select: {
            messages: {
              where: { isInternal: false },
              orderBy: { sentAt: "desc" },
              take: 1,
              select: { direction: true, sentAt: true },
            },
          },
        }),
        prisma.inboxThread.count({
          where: {
            clinicId: dbUser.clinicId,
            status: "ARCHIVED",
            updatedAt: { gte: startOfToday },
            ...(visibilityAnd.length ? { AND: visibilityAnd } : {}),
          },
        }),
        prisma.inboxThread.count({
          where: {
            clinicId: dbUser.clinicId,
            channel: "WHATSAPP",
            botActive: true,
            status: { not: "ARCHIVED" },
            ...(visibilityAnd.length ? { AND: visibilityAnd } : {}),
          },
        }),
      ]);
      // Esperando respuesta: el último mensaje visible del hilo es del
      // paciente (IN) y lleva más de 20 min sin contestarse.
      const waitingOver20m = openThreads.filter((t) => {
        const last = t.messages[0];
        return !!last && last.direction === "IN" && last.sentAt < twentyMinAgo;
      }).length;
      stats = { waitingOver20m, resolvedToday, botAuto };
    }

    return NextResponse.json({
      threads: threadsPayload,
      counts,
      serverTime: serverTime.toISOString(),
      ...(stats ? { stats } : {}),
    });
  } catch (err) {
    if (isMissingTable(err)) {
      return jsonError("schema_not_migrated", 503, {
        hint: "Aplica la migración 20260427210000_inbox_reminders en Supabase.",
      });
    }
    console.error("[GET /api/inbox/threads]", err);
    return jsonError("internal_error", 500, {
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}

/** POST /api/inbox/threads — crea un thread + opcional primer mensaje OUT. */
export async function POST(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    const denied = denyIfMissingPermission(dbUser, "inbox.send");
    if (denied) return denied;
    const body = await req.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    if (parsed.data.patientId) {
      const patient = await prisma.patient.findFirst({
        where: { id: parsed.data.patientId, clinicId: dbUser.clinicId },
        select: { id: true },
      });
      if (!patient) return jsonError("patient_not_found", 404);
    }

    const now = new Date();
    const thread = await prisma.inboxThread.create({
      data: {
        clinicId: dbUser.clinicId,
        channel: parsed.data.channel,
        externalId: parsed.data.externalId ?? null,
        patientId: parsed.data.patientId ?? null,
        subject: parsed.data.subject,
        status: "UNREAD",
        lastMessageAt: now,
        ...(parsed.data.initialMessage
          ? {
              messages: {
                create: {
                  direction: "OUT",
                  body: parsed.data.initialMessage,
                  sentById: dbUser.id,
                  sentAt: now,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        channel: true,
        subject: true,
        status: true,
        lastMessageAt: true,
      },
    });
    return NextResponse.json({ thread }, { status: 201 });
  } catch (err) {
    if (isMissingTable(err)) {
      return jsonError("schema_not_migrated", 503);
    }
    console.error("[POST /api/inbox/threads]", err);
    return jsonError("internal_error", 500);
  }
}

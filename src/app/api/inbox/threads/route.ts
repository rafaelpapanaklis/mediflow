import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

const STATUS = z.enum(["UNREAD", "READ", "ARCHIVED", "SNOOZED"]);
const CHANNEL = z.enum(["WHATSAPP", "EMAIL", "PORTAL_FORM", "VALIDATION", "REMINDER"]);

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
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    const denied = denyIfMissingPermission(dbUser, "inbox.view");
    if (denied) return denied;

    const sp = req.nextUrl.searchParams;
    const where: Prisma.InboxThreadWhereInput = {
      clinicId: dbUser.clinicId,
    };
    const status = sp.get("status");
    if (status && ["UNREAD", "READ", "ARCHIVED", "SNOOZED"].includes(status)) {
      where.status = status as "UNREAD" | "READ" | "ARCHIVED" | "SNOOZED";
    }
    const channel = sp.get("channel");
    if (channel && ["WHATSAPP", "EMAIL", "PORTAL_FORM", "VALIDATION", "REMINDER"].includes(channel)) {
      where.channel = channel as "WHATSAPP" | "EMAIL" | "PORTAL_FORM" | "VALIDATION" | "REMINDER";
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
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { messages: true } },
      },
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

    return NextResponse.json({ threads, counts });
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

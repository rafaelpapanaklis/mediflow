import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5_000).optional(),
  dueAt: z.string().datetime(),
  assignedToId: z.string().min(1),
  patientId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
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

function isMissingTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "42P01";
}

/** GET /api/reminders?status=&assignedTo=&dueBefore=&dueAfter= */
export async function GET(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const where: Prisma.ReminderWhereInput = { clinicId: dbUser.clinicId };

    const status = sp.get("status");
    if (status && ["PENDING", "DONE", "DISMISSED"].includes(status)) {
      where.status = status as "PENDING" | "DONE" | "DISMISSED";
    }
    const assignedTo = sp.get("assignedTo");
    if (assignedTo === "me") where.assignedToId = dbUser.id;
    else if (assignedTo) where.assignedToId = assignedTo;

    const dueBefore = sp.get("dueBefore");
    const dueAfter = sp.get("dueAfter");
    if (dueBefore || dueAfter) {
      where.dueAt = {};
      if (dueBefore) (where.dueAt as Prisma.DateTimeFilter).lte = new Date(dueBefore);
      if (dueAfter) (where.dueAt as Prisma.DateTimeFilter).gte = new Date(dueAfter);
    }

    const reminders = await prisma.reminder.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      select: {
        id: true,
        title: true,
        body: true,
        dueAt: true,
        status: true,
        completedAt: true,
        threadId: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ reminders });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        { error: "schema_not_migrated", hint: "Aplica la migración 20260427210000_inbox_reminders." },
        { status: 503 },
      );
    }
    console.error("[GET /api/reminders]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST /api/reminders — crea recordatorio. */
export async function POST(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // Verifica que assignedToId pertenezca a la misma clínica.
    const assignee = await prisma.user.findFirst({
      where: { id: parsed.data.assignedToId, clinicId: dbUser.clinicId, isActive: true },
      select: { id: true },
    });
    if (!assignee) return NextResponse.json({ error: "assignee_not_found" }, { status: 404 });

    if (parsed.data.patientId) {
      const patient = await prisma.patient.findFirst({
        where: { id: parsed.data.patientId, clinicId: dbUser.clinicId },
        select: { id: true },
      });
      if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }

    if (parsed.data.threadId) {
      const thread = await prisma.inboxThread.findFirst({
        where: { id: parsed.data.threadId, clinicId: dbUser.clinicId },
        select: { id: true },
      });
      if (!thread) return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }

    const reminder = await prisma.reminder.create({
      data: {
        clinicId: dbUser.clinicId,
        createdById: dbUser.id,
        assignedToId: parsed.data.assignedToId,
        patientId: parsed.data.patientId ?? null,
        threadId: parsed.data.threadId ?? null,
        title: parsed.data.title,
        body: parsed.data.body ?? null,
        dueAt: new Date(parsed.data.dueAt),
        status: "PENDING",
      },
      select: {
        id: true,
        title: true,
        body: true,
        dueAt: true,
        status: true,
        threadId: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ reminder }, { status: 201 });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json({ error: "schema_not_migrated" }, { status: 503 });
    }
    console.error("[POST /api/reminders]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

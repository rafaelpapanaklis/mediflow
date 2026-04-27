import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum(["PENDING", "DONE", "DISMISSED"]).optional(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(5_000).nullable().optional(),
  dueAt: z.string().datetime().optional(),
  assignedToId: z.string().min(1).optional(),
}).refine((v) => Object.keys(v).length > 0, "no fields to update");

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

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const existing = await prisma.reminder.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true, status: true },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (parsed.data.assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: parsed.data.assignedToId, clinicId: dbUser.clinicId, isActive: true },
        select: { id: true },
      });
      if (!assignee) return NextResponse.json({ error: "assignee_not_found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.body !== undefined) data.body = parsed.data.body;
    if (parsed.data.dueAt !== undefined) data.dueAt = new Date(parsed.data.dueAt);
    if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;
    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
      if (parsed.data.status === "DONE" && existing.status !== "DONE") {
        data.completedAt = new Date();
        data.completedById = dbUser.id;
      } else if (parsed.data.status === "PENDING") {
        data.completedAt = null;
        data.completedById = null;
      }
    }

    const updated = await prisma.reminder.update({
      where: { id: params.id },
      data,
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
      },
    });

    return NextResponse.json({ reminder: updated });
  } catch (err) {
    console.error("[PATCH /api/reminders/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    await prisma.reminder.deleteMany({
      where: { id: params.id, clinicId: dbUser.clinicId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/reminders/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

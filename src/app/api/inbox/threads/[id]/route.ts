import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum(["UNREAD", "READ", "ARCHIVED", "SNOOZED"]).optional(),
  assignedToId: z.string().nullable().optional(),
  patientId: z.string().nullable().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  subject: z.string().min(1).max(200).optional(),
  tags: z.array(z.string()).optional(),
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

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const thread = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        messages: {
          orderBy: { sentAt: "asc" },
          select: {
            id: true, direction: true, body: true, attachments: true,
            sentAt: true, isInternal: true,
            sentBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ thread });
  } catch (err) {
    if ((err as { code?: string }).code === "P2021") {
      return NextResponse.json(
        { error: "schema_not_migrated", hint: "Aplica migración inbox." },
        { status: 503 },
      );
    }
    console.error("[GET inbox/threads/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

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
    const existing = await prisma.inboxThread.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;
    if (parsed.data.patientId !== undefined) data.patientId = parsed.data.patientId;
    if (parsed.data.snoozedUntil !== undefined) {
      data.snoozedUntil = parsed.data.snoozedUntil ? new Date(parsed.data.snoozedUntil) : null;
    }
    if (parsed.data.subject !== undefined) data.subject = parsed.data.subject;
    if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;

    const updated = await prisma.inboxThread.update({
      where: { id: params.id },
      data,
      select: {
        id: true, status: true, assignedToId: true, snoozedUntil: true,
        subject: true, tags: true,
      },
    });
    return NextResponse.json({ thread: updated });
  } catch (err) {
    console.error("[PATCH inbox/threads/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    await prisma.inboxThread.deleteMany({
      where: { id: params.id, clinicId: dbUser.clinicId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE inbox/threads/:id]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

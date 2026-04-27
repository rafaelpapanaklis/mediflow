import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";

export const dynamic = "force-dynamic";

const PRIORITY = z.enum(["LOW", "NORMAL", "HIGH"]);
const STATUS = z.enum(["PENDING", "FULFILLED", "DISCARDED"]);

const PatchSchema = z
  .object({
    status: STATUS.optional(),
    appointmentId: z.string().min(1).optional(),
    priority: PRIORITY.optional(),
    reason: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    preferredWindow: z.string().nullable().optional(),
    preferredDoctorId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  const existing = await prisma.waitlistEntry.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, resolvedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data: {
    resolvedAt?: Date | null;
    resolvedAppointmentId?: string | null;
    priority?: "LOW" | "NORMAL" | "HIGH";
    reason?: string | null;
    notes?: string | null;
    preferredWindow?: string | null;
    preferredDoctorId?: string | null;
  } = {};

  if (parsed.data.status === "DISCARDED") {
    data.resolvedAt = new Date();
    data.resolvedAppointmentId = null;
  } else if (parsed.data.status === "FULFILLED") {
    if (!parsed.data.appointmentId) {
      return NextResponse.json(
        { error: "missing_appointmentId_for_fulfilled" },
        { status: 400 },
      );
    }
    data.resolvedAt = new Date();
    data.resolvedAppointmentId = parsed.data.appointmentId;
  } else if (parsed.data.status === "PENDING") {
    data.resolvedAt = null;
    data.resolvedAppointmentId = null;
  }

  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
  if (parsed.data.reason !== undefined) data.reason = parsed.data.reason;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.preferredWindow !== undefined) {
    data.preferredWindow = parsed.data.preferredWindow;
  }
  if (parsed.data.preferredDoctorId !== undefined) {
    data.preferredDoctorId = parsed.data.preferredDoctorId;
  }

  const updated = await prisma.waitlistEntry.update({
    where: { id: params.id },
    data,
    select: {
      id: true,
      resolvedAt: true,
      resolvedAppointmentId: true,
      priority: true,
      reason: true,
      notes: true,
      preferredWindow: true,
      preferredDoctorId: true,
    },
  });

  return NextResponse.json({ entry: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  const existing = await prisma.waitlistEntry.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, resolvedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.resolvedAt) {
    return NextResponse.json({ ok: true });
  }

  const resolvedAppointmentId =
    req.nextUrl.searchParams.get("resolvedAppointmentId");

  await prisma.waitlistEntry.update({
    where: { id: params.id },
    data: {
      resolvedAt: new Date(),
      resolvedAppointmentId: resolvedAppointmentId ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

const VALID_STATUSES = new Set(["SENT", "ACCEPTED", "REJECTED", "RESPONDED", "CANCELLED"]);

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const ref = await prisma.referral.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    include: {
      patient: { select: { firstName: true, lastName: true, patientNumber: true } },
      fromDoctor: { select: { firstName: true, lastName: true, cedulaProfesional: true, especialidad: true } },
    },
  });
  if (!ref) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ref);
}

/**
 * PATCH /api/referrals/[id] — actualizar status / respuesta / cancelar.
 * Body: { status?, response? }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await prisma.referral.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: { status?: string; response?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data: {
    status?: "SENT" | "ACCEPTED" | "REJECTED" | "RESPONDED" | "CANCELLED";
    response?: string | null;
    respondedAt?: Date | null;
  } = {};
  if (body.status !== undefined) {
    const s = String(body.status).toUpperCase();
    if (!VALID_STATUSES.has(s)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    data.status = s as "SENT" | "ACCEPTED" | "REJECTED" | "RESPONDED" | "CANCELLED";
    if (s === "RESPONDED") data.respondedAt = new Date();
  }
  if (body.response !== undefined) {
    data.response = body.response?.slice(0, 4000) ?? null;
  }

  const updated = await prisma.referral.update({
    where: { id: params.id },
    data,
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "patient",
    entityId: existing.patientId,
    action: "update",
    before: { status: existing.status, response: existing.response },
    after:  { status: updated.status, response: updated.response },
  });

  return NextResponse.json(updated);
}

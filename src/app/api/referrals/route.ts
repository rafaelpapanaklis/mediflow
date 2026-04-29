import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["OUTGOING", "INCOMING"]);

/**
 * GET /api/referrals?patientId=
 * Multi-tenant: filtra clinicId desde getCurrentUser.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const patientId = req.nextUrl.searchParams.get("patientId");
  const where: Record<string, unknown> = { clinicId: user.clinicId };
  if (patientId) where.patientId = patientId;

  const list = await prisma.referral.findMany({
    where,
    orderBy: { sentAt: "desc" },
    include: {
      patient:    { select: { firstName: true, lastName: true, patientNumber: true } },
      fromDoctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
    },
  });
  return NextResponse.json({ referrals: list });
}

/**
 * POST /api/referrals
 * Body: {
 *   patientId, type, toClinicName, toClinicClues?, toDoctorName?,
 *   toSpecialty?, reason, clinicalSummary, relevantDiagnoses?
 * }
 *
 * Multi-tenant: clinicId siempre del user. Validamos que el paciente
 * pertenezca a esa clínica.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: {
    patientId?: string;
    type?: string;
    toClinicName?: string;
    toClinicClues?: string;
    toDoctorName?: string;
    toSpecialty?: string;
    reason?: string;
    clinicalSummary?: string;
    relevantDiagnoses?: unknown;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = String(body.type ?? "OUTGOING").toUpperCase();
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  if (!body.patientId || !body.toClinicName || !body.reason || !body.clinicalSummary) {
    return NextResponse.json({ error: "patientId_toClinicName_reason_clinicalSummary_required" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });

  const referral = await prisma.referral.create({
    data: {
      clinicId: user.clinicId,
      patientId: body.patientId,
      fromDoctorId: user.id,
      toClinicName: body.toClinicName.slice(0, 200),
      toClinicClues: body.toClinicClues?.slice(0, 11) || null,
      toDoctorName: body.toDoctorName?.slice(0, 200) || null,
      toSpecialty: body.toSpecialty?.slice(0, 100) || null,
      reason: body.reason,
      clinicalSummary: body.clinicalSummary,
      relevantDiagnoses: (body.relevantDiagnoses as object | undefined) ?? undefined,
      type: type as "OUTGOING" | "INCOMING",
      status: "SENT",
    },
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "patient",
    entityId: body.patientId,
    action: "update",
    after: { referralCreated: { id: referral.id, type, toClinicName: referral.toClinicName } },
  });

  return NextResponse.json(referral, { status: 201 });
}

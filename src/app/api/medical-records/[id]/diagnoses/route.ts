import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * POST /api/medical-records/[id]/diagnoses
 * Body: { cie10Code: string, isPrimary?: boolean, note?: string }
 *
 * Multi-tenant: validamos que el medical_record pertenezca a ctx.clinicId
 * antes de crear el dx.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN", "DOCTOR"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const record = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!record) return NextResponse.json({ error: "record_not_found" }, { status: 404 });

  let body: { cie10Code?: string; isPrimary?: boolean; note?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const cie10Code = String(body.cie10Code ?? "").toUpperCase().trim();
  if (!cie10Code) return NextResponse.json({ error: "cie10Code_required" }, { status: 400 });

  // Verificar que el código exista en el catálogo. Si no, error claro.
  const exists = await prisma.cie10Code.findUnique({ where: { code: cie10Code } });
  if (!exists) return NextResponse.json({ error: "cie10Code_not_found" }, { status: 404 });

  // Si vino isPrimary=true, des-marcar primarios anteriores del mismo record.
  if (body.isPrimary === true) {
    await prisma.medicalRecordDiagnosis.updateMany({
      where: { medicalRecordId: params.id, isPrimary: true },
      data:  { isPrimary: false },
    });
  }

  const dx = await prisma.medicalRecordDiagnosis.create({
    data: {
      medicalRecordId: params.id,
      cie10Code,
      isPrimary: body.isPrimary ?? false,
      note: body.note?.slice(0, 500) ?? null,
    },
    include: { cie10: true },
  });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "record",
    entityId: params.id,
    action: "update",
    after: { diagnosisAdded: { code: cie10Code, isPrimary: dx.isPrimary } },
  });

  return NextResponse.json(dx, { status: 201 });
}

/**
 * GET /api/medical-records/[id]/diagnoses — listar dx del expediente.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const record = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!record) return NextResponse.json({ error: "record_not_found" }, { status: 404 });

  const dxs = await prisma.medicalRecordDiagnosis.findMany({
    where: { medicalRecordId: params.id },
    include: { cie10: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ diagnoses: dxs });
}

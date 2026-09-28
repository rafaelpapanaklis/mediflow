import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { negarApiPorCategoria } from "@/lib/dashboard/guardia-categoria.server";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Guardia de categoría (sesión): 403 si el giro de la clínica no tiene esta función.
  const fuera = negarApiPorCategoria("/dashboard/formulas", ctx.clinicCategory);
  if (fuera) return fuera;

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const type = searchParams.get("type");

  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  // Visibilidad por paciente: sin este gate se leían las fórmulas de un
  // paciente restringido con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const records = await prisma.formulaRecord.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId,
      ...(type ? { type } : {}),
    },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { appliedAt: "desc" },
  });

  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Guardia de categoría (sesión): 403 si el giro de la clínica no tiene esta función.
  const fuera = negarApiPorCategoria("/dashboard/formulas", ctx.clinicCategory);
  if (fuera) return fuera;

  const body = await req.json();
  const { patientId, type, formula, notes, appliedBy } = body;

  if (!patientId || !type || !formula) {
    return NextResponse.json({ error: "patientId, type, and formula are required" }, { status: 400 });
  }

  // Validate patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  // Visibilidad por paciente: no crear fórmulas sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const record = await prisma.formulaRecord.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      type,
      formula,
      notes: notes ?? null,
      appliedBy: appliedBy ?? null,
    },
  });

  return NextResponse.json(record, { status: 201 });
}

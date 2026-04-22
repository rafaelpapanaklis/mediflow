import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { readActiveClinicCookie } from "@/lib/active-clinic";

const recordSchema = z.object({
  patientId:     z.string().min(1),
  subjective:    z.string().optional().nullable(),
  objective:     z.string().optional().nullable(),
  assessment:    z.string().optional().nullable(),
  plan:          z.string().optional().nullable(),
  diagnoses:     z.any().optional().nullable(),
  vitals:        z.any().optional().nullable(),
  specialtyData: z.any().optional().nullable(),
  isPrivate:     z.boolean().optional(),
});

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "200"), 1), 500);
  const skip  = Math.max(parseInt(searchParams.get("skip") ?? "0"), 0);
  const where: any = { clinicId: dbUser.clinicId };
  if (patientId) where.patientId = patientId;
  const records = await prisma.medicalRecord.findMany({
    where: { ...where, OR: [{ isPrivate: false }, { isPrivate: true, doctorId: dbUser.id }] },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { visitDate: "desc" },
    take: limit,
    skip,
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: parsed.data.patientId, clinicId: dbUser.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const record = await prisma.medicalRecord.create({
    data: {
      clinicId:      dbUser.clinicId,
      doctorId:      dbUser.id,
      patientId:     parsed.data.patientId,
      subjective:    parsed.data.subjective ?? null,
      objective:     parsed.data.objective ?? null,
      assessment:    parsed.data.assessment ?? null,
      plan:          parsed.data.plan ?? null,
      diagnoses:     parsed.data.diagnoses ?? undefined,
      vitals:        parsed.data.vitals ?? undefined,
      specialtyData: parsed.data.specialtyData ?? undefined,
      isPrivate:     parsed.data.isPrivate ?? false,
    },
  });
  return NextResponse.json(record, { status: 201 });
}

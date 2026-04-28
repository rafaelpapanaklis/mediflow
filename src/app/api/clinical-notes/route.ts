import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).optional(),
  doctorId: z.string().min(1).optional(),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
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

/**
 * POST /api/clinical-notes
 * Crea una nota clínica en estado DRAFT, opcionalmente vinculada a una
 * cita (appointmentId guardado dentro de specialtyData para no requerir
 * migración del schema).
 */
export async function POST(req: NextRequest) {
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

  const patient = await prisma.patient.findFirst({
    where: { id: parsed.data.patientId, clinicId: dbUser.clinicId },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  }

  const doctorId = parsed.data.doctorId ?? dbUser.id;
  if (parsed.data.doctorId) {
    const d = await prisma.user.findFirst({
      where: { id: parsed.data.doctorId, clinicId: dbUser.clinicId, isActive: true },
      select: { id: true },
    });
    if (!d) return NextResponse.json({ error: "doctor_not_found" }, { status: 404 });
  }

  let appointmentExists = true;
  if (parsed.data.appointmentId) {
    const a = await prisma.appointment.findFirst({
      where: { id: parsed.data.appointmentId, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    appointmentExists = a !== null;
    if (!appointmentExists) {
      return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });
    }
  }

  const record = await prisma.medicalRecord.create({
    data: {
      clinicId: dbUser.clinicId,
      patientId: parsed.data.patientId,
      doctorId,
      subjective: parsed.data.subjective ?? null,
      objective: parsed.data.objective ?? null,
      assessment: parsed.data.assessment ?? null,
      plan: parsed.data.plan ?? null,
      specialtyData: {
        status: "DRAFT",
        appointmentId: parsed.data.appointmentId ?? null,
        attachments: [],
      },
    },
    select: {
      id: true,
      patientId: true,
      doctorId: true,
      subjective: true,
      objective: true,
      assessment: true,
      plan: true,
      specialtyData: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ note: record }, { status: 201 });
}

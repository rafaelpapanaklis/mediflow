import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

// GET /api/portal/[token] — public endpoint, no auth required
// Returns patient's own data for the portal
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 20); // 20 requests per minute per IP
  if (rl) return rl;

  const patient = await prisma.patient.findUnique({
    where: { portalToken: params.token },
    include: {
      primaryDoctor: { select: { firstName: true, lastName: true, specialty: true } },
      appointments: {
        where: { status: { not: "CANCELLED" } },
        include: { doctor: { select: { firstName: true, lastName: true } } },
        orderBy: { date: "desc" },
        take: 20,
      },
      clinic: { select: { name: true, phone: true, address: true, logoUrl: true } },
    },
  });

  if (!patient) return NextResponse.json({ error: "Enlace inválido" }, { status: 404 });

  // Check token expiry
  if (patient.portalTokenExpiry && new Date(patient.portalTokenExpiry) < new Date()) {
    return NextResponse.json({ error: "Este enlace ha expirado. Solicita uno nuevo a tu médico." }, { status: 410 });
  }

  // Return only safe patient data (no internal IDs, no sensitive clinic data)
  return NextResponse.json({
    patient: {
      firstName:         patient.firstName,
      lastName:          patient.lastName,
      patientNumber:     patient.patientNumber,
      dob:               patient.dob,
      gender:            patient.gender,
      phone:             patient.phone,
      email:             patient.email,
      bloodType:         patient.bloodType,
      allergies:         patient.allergies,
      chronicConditions: patient.chronicConditions,
      currentMedications:patient.currentMedications,
    },
    appointments: patient.appointments.map(a => ({
      type:      a.type,
      date:      a.date,
      startTime: a.startTime,
      endTime:   a.endTime,
      status:    a.status,
      doctor:    `Dr/a. ${a.doctor.firstName} ${a.doctor.lastName}`,
      notes:     a.notes,
    })),
    doctor: patient.primaryDoctor ? {
      name:      `Dr/a. ${patient.primaryDoctor.firstName} ${patient.primaryDoctor.lastName}`,
      specialty: patient.primaryDoctor.specialty,
    } : null,
    clinic: {
      name:    patient.clinic.name,
      phone:   patient.clinic.phone,
      address: patient.clinic.address,
      logo:    patient.clinic.logoUrl,
    },
  });
}

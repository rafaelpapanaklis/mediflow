import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const rl = rateLimit(req, 20);
  if (rl) return rl;
  const rx = await prisma.prescription.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      issuedAt: true,
      expiresAt: true,
      medications: true,
      indications: true,
      cofeprisGroup: true,
      cofeprisFolio: true,
      doctor: { select: { firstName: true, lastName: true, specialty: true } },
      clinic: { select: { name: true, city: true, phone: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!rx) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });

  const isExpired = rx.expiresAt ? rx.expiresAt.getTime() < Date.now() : false;

  return NextResponse.json({
    id: rx.id,
    valid: !isExpired,
    isExpired,
    issuedAt: rx.issuedAt,
    expiresAt: rx.expiresAt,
    medications: rx.medications,
    indications: rx.indications,
    cofeprisGroup: rx.cofeprisGroup,
    cofeprisFolio: rx.cofeprisFolio,
    doctor: `${rx.doctor.firstName} ${rx.doctor.lastName}`,
    doctorSpecialty: rx.doctor.specialty,
    clinic: rx.clinic.name,
    clinicCity: rx.clinic.city,
    clinicPhone: rx.clinic.phone,
    patient: `${rx.patient.firstName} ${rx.patient.lastName.charAt(0)}.`,
  });
}

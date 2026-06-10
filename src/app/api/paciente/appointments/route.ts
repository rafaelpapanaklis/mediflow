// GET /api/paciente/appointments — Implementa A6. Respuesta: PacienteCitasResponse.
// · getPatientPortalContext() | 401. patientIds de ctx.links.
// · clinics: igual que summary (links → patient → clinic).
// · upcoming: startsAt >= now, status notIn [CANCELLED, NO_SHOW], asc.
// · past: startsAt < now O status in [CANCELLED, NO_SHOW], desc, take 100.
// · Select paciente-safe SOLO: id, clinicId, type, status, startsAt, endsAt,
//   doctor { firstName, lastName } → doctorName ("Dr/a. Nombre Apellido" NO —
//   solo "Nombre Apellido", el prefijo lo pone la UI si quiere).
// · NUNCA: notes, price, tokens de telemedicina, overrideReason, etc.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import type {
  PacienteCita,
  PacienteCitasResponse,
  PacienteClinica,
} from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

/** Select paciente-safe: NUNCA notes, price, tokens tele, overrideReason, etc. */
const citaSelect = {
  id: true,
  clinicId: true,
  type: true,
  status: true,
  startsAt: true,
  endsAt: true,
  doctor: { select: { firstName: true, lastName: true } },
};

type CitaRow = {
  id: string;
  clinicId: string;
  type: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  doctor: { firstName: string; lastName: string };
};

function toCita(a: CitaRow): PacienteCita {
  return {
    id: a.id,
    clinicId: a.clinicId,
    type: a.type,
    status: a.status,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
  };
}

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  // Multi-tenant: SOLO los pacientes vinculados a la cuenta de la sesión.
  const patientIds = ctx.links.map((l) => l.patientId);
  const now = new Date();

  const [links, upcomingRows, pastRows] = await Promise.all([
    prisma.patientAccountLink.findMany({
      where: { accountId: ctx.account.id, patient: { deletedAt: null } },
      select: {
        clinicId: true,
        patient: {
          select: {
            id: true,
            patientNumber: true,
            clinic: {
              select: { id: true, name: true, slug: true, logoUrl: true, city: true, phone: true },
            },
          },
        },
      },
    }),
    // Próximas: futuras y no canceladas/no-show, ascendente.
    prisma.appointment.findMany({
      where: {
        patientId: { in: patientIds },
        patient: { deletedAt: null },
        startsAt: { gte: now },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "asc" },
      select: citaSelect,
    }),
    // Anteriores: ya pasaron O fueron canceladas/no-show (incluye futuras
    // canceladas, que upcoming ya excluye — sin duplicados), descendente.
    prisma.appointment.findMany({
      where: {
        patientId: { in: patientIds },
        patient: { deletedAt: null },
        OR: [{ startsAt: { lt: now } }, { status: { in: ["CANCELLED", "NO_SHOW"] } }],
      },
      orderBy: { startsAt: "desc" },
      take: 100,
      select: citaSelect,
    }),
  ]);

  const clinics: PacienteClinica[] = links.map((l) => ({
    clinicId: l.clinicId,
    clinicName: l.patient.clinic.name,
    clinicSlug: l.patient.clinic.slug,
    logoUrl: l.patient.clinic.logoUrl,
    city: l.patient.clinic.city,
    phone: l.patient.clinic.phone,
    patientId: l.patient.id,
    patientNumber: l.patient.patientNumber,
  }));

  const body: PacienteCitasResponse = {
    clinics,
    upcoming: upcomingRows.map(toCita),
    past: pastRows.map(toCita),
  };
  return NextResponse.json(body);
}

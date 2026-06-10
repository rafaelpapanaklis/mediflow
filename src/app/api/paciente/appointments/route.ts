// GET /api/paciente/appointments — Implementa A6. Respuesta: PacienteCitasResponse.
// · getPatientPortalContext() | 401. patientIds de ctx.links.
// · clinics: igual que summary (links → patient → clinic).
// · upcoming: startsAt >= now, status notIn [CANCELLED, NO_SHOW], asc.
// · past: startsAt < now O status in [CANCELLED, NO_SHOW], desc, take 100.
// · Select paciente-safe SOLO: id, clinicId, type, status, startsAt, endsAt,
//   doctor { firstName, lastName } → doctorName ("Dr/a. Nombre Apellido" NO —
//   solo "Nombre Apellido", el prefijo lo pone la UI si quiere).
// · NUNCA: notes, price, tokens de telemedicina, overrideReason, etc.
// · WS1-T5: cada cita de `upcoming` trae `pendingChange` (solicitud PENDING de
//   esa cita o null, UNA query extra) y el response trae `policies` (por
//   clínica de los links: minHours + autoApprove). En `past` siempre null.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import type {
  PacienteCambioPendiente,
  PacienteCita,
  PacienteCitasResponse,
  PacienteClinica,
  PacientePoliticaCambios,
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

function toCita(a: CitaRow, pendingChange: PacienteCambioPendiente | null): PacienteCita {
  return {
    id: a.id,
    clinicId: a.clinicId,
    type: a.type,
    status: a.status,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
    pendingChange,
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
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                city: true,
                phone: true,
                patientChangesMinHours: true,
                patientChangesAutoApprove: true,
              },
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

  // WS1-T5: solicitudes PENDING de las citas próximas en UNA sola query extra.
  // Scope multi-tenant doble: ids de citas ya filtradas por la sesión + patientIds.
  const pendingByAppt = new Map<string, PacienteCambioPendiente>();
  const upcomingIds = upcomingRows.map((a) => a.id);
  if (upcomingIds.length > 0) {
    const pendingRows = await prisma.appointmentChangeRequest.findMany({
      where: {
        appointmentId: { in: upcomingIds },
        patientId: { in: patientIds },
        status: "PENDING",
      },
      select: {
        id: true,
        appointmentId: true,
        type: true,
        proposedStartsAt: true,
        createdAt: true,
      },
    });
    for (const r of pendingRows) {
      pendingByAppt.set(r.appointmentId, {
        id: r.id,
        type: r.type as PacienteCambioPendiente["type"],
        proposedStartsAt: r.proposedStartsAt ? r.proposedStartsAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      });
    }
  }

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

  // WS1-T5: política de cambios por clínica (deduplicada por clinicId).
  const policiesMap = new Map<string, PacientePoliticaCambios>();
  for (const l of links) {
    if (!policiesMap.has(l.clinicId)) {
      policiesMap.set(l.clinicId, {
        clinicId: l.clinicId,
        minHours: l.patient.clinic.patientChangesMinHours ?? 24,
        autoApprove: l.patient.clinic.patientChangesAutoApprove ?? false,
      });
    }
  }

  const body: PacienteCitasResponse = {
    clinics,
    upcoming: upcomingRows.map((a) => toCita(a, pendingByAppt.get(a.id) ?? null)),
    past: pastRows.map((a) => toCita(a, null)),
    policies: Array.from(policiesMap.values()),
  };
  return NextResponse.json(body);
}

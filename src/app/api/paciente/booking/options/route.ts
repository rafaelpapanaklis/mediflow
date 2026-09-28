// GET /api/paciente/booking/options — WS2-T1.
//
// Opciones para que un paciente CON SESIÓN agende una cita NUEVA: por cada
// clínica donde tiene expediente vinculado (ctx.links) devuelve la clínica
// (id, nombre, timezone) y sus doctores activos agendables.
//
// Multi-tenant estricto: SOLO clínicas presentes en ctx.links. NUNCA acepta
// clinicId del cliente. 401 si no hay sesión.
//
// 200: PacienteBookingOptionsResponse
//   { clinics: [{ clinicId, clinicName, timezone, doctors:[{id,name,specialty}],
//                patients:[{patientId,name}] }] }
//
// ws1-t5 (ronda 6, hallazgo 93): `patients` son los pacientes de la CUENTA en
// cada clínica. Una mamá con dos hijos elegía clínica, doctor y hora, y la
// cita quedaba siempre a nombre del primero. Con dos o más, la página pregunta
// para quién es.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import type {
  PacienteBookingClinica,
  PacienteBookingOptionsResponse,
} from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  // Clínicas únicas de los links de la sesión (fuente de verdad multi-tenant).
  const clinicIds = Array.from(new Set(ctx.links.map((l) => l.clinicId)));
  if (clinicIds.length === 0) {
    const empty: PacienteBookingOptionsResponse = { clinics: [] };
    return NextResponse.json(empty);
  }

  const [clinics, vinculos] = await Promise.all([
    prisma.clinic.findMany({
      where: { id: { in: clinicIds } },
      select: {
        id: true,
        name: true,
        timezone: true,
        users: {
          where: { isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
          select: { id: true, firstName: true, lastName: true, specialty: true },
          orderBy: { firstName: "asc" },
        },
      },
    }),
    // Los pacientes salen de los vínculos de la CUENTA de la sesión, nunca de
    // una búsqueda por nombre o teléfono.
    prisma.patientAccountLink.findMany({
      where: { accountId: ctx.account.id, patient: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: {
        clinicId: true,
        patientId: true,
        patient: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  // Mapea respetando el orden de los links (estable) → {id,name,specialty}.
  const byId = new Map(clinics.map((c) => [c.id, c]));
  const out: PacienteBookingClinica[] = [];
  for (const id of clinicIds) {
    const c = byId.get(id);
    if (!c) continue;
    out.push({
      clinicId: c.id,
      clinicName: c.name,
      timezone: c.timezone,
      doctors: c.users.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        specialty: u.specialty ?? null,
      })),
      patients: vinculos
        .filter((v) => v.clinicId === c.id)
        .map((v) => ({
          patientId: v.patientId,
          name: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
        })),
    });
  }

  const body: PacienteBookingOptionsResponse = { clinics: out };
  return NextResponse.json(body);
}

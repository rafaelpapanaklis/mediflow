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
//   { clinics: [{ clinicId, clinicName, timezone, doctors:[{id,name,specialty}] }] }

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

  const clinics = await prisma.clinic.findMany({
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
  });

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
    });
  }

  const body: PacienteBookingOptionsResponse = { clinics: out };
  return NextResponse.json(body);
}

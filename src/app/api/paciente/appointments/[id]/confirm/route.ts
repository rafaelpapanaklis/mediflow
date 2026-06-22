// POST /api/paciente/appointments/[id]/confirm — WS1-T3
//
// El paciente CON CUENTA confirma su asistencia a una cita desde el panel.
// Equivale al endpoint público por token (/api/public/appointment-confirm),
// pero aquí la credencial es la sesión del portal: el id de la cita viene de la
// URL y la PERTENENCIA se valida SIEMPRE contra ctx.links (patientId+clinicId),
// nunca del body. Misma transición de estado que el flujo público.
//
// Reglas (en orden):
//   1) Guard getPatientPortalContext() | 401.
//   2) La cita debe pertenecer a un link (patientId + clinicId) → 404 genérico
//      (no se revela la existencia de citas ajenas).
//   3) Idempotente: si ya está CONFIRMED → { ok:true, changed:false }.
//   4) Solo confirmable si status ∈ [PENDING, SCHEDULED]; otro → 409.
//   5) No confirmar una cita que ya pasó (startsAt <= ahora) → 410.
//   6) update status=CONFIRMED, confirmedAt=now → { ok:true, changed:true }.
//
// Rate-limit por IP+ruta. clinicId/patientId SIEMPRE de la cita verificada.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const limited = rateLimit(req, 10, 60_000);
  if (limited) return limited;

  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  const appt = await prisma.appointment.findUnique({
    where: { id: params.id },
    select: { id: true, clinicId: true, patientId: true, startsAt: true, status: true },
  });

  // Multi-tenant: la cita debe pertenecer a un link (patientId + clinicId) de la
  // sesión. 404 genérico — jamás se confía en ids del body.
  const owned =
    appt !== null &&
    ctx.links.some((l) => l.patientId === appt.patientId && l.clinicId === appt.clinicId);
  if (!appt || !owned) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Idempotente: ya confirmada (independiente de la hora).
  if (appt.status === "CONFIRMED") {
    return NextResponse.json({ ok: true, status: "CONFIRMED", changed: false });
  }

  // Solo PENDING/SCHEDULED son confirmables; cualquier otro estado, conflicto.
  if (appt.status !== "PENDING" && appt.status !== "SCHEDULED") {
    return NextResponse.json({ error: "not_confirmable", status: appt.status }, { status: 409 });
  }

  // No confirmar una cita que ya pasó.
  const now = new Date();
  if (appt.startsAt <= now) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "CONFIRMED", confirmedAt: now },
  });

  return NextResponse.json({ ok: true, status: "CONFIRMED", changed: true });
}

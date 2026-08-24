// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/appointments/[id]/status  → avanzar el estado de la visita
//
// El flujo NO se inventa aquí: sale de canTransition() en
// src/lib/barber/types.ts (pendiente → confirmada → en silla → completada,
// más "no llegó" y "cancelada"). Cualquier salto fuera del flujo se rechaza
// con 409, aunque la UI lo pida.
//
// M-22 (dental): cancelar, marcar "no llegó" o completar INVALIDA los
// recordatorios pendientes de esa visita. Nadie recibe un aviso de una
// visita que ya no va a pasar.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canTransition,
  nextStatuses,
  type BarberAppointmentStatus,
} from "@/lib/barber/types";
import { toAppointmentDTO, type BarberReminderInvalidationCause } from "@/lib/barber/agenda";
import {
  APPOINTMENT_INCLUDE,
  asString,
  invalidateAppointmentReminders,
  jsonError,
  openAgendaGate,
  readJson,
} from "../../_server";

export const dynamic = "force-dynamic";

const VALID: BarberAppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
  "NO_SHOW",
  "CANCELLED",
];

/** Estados que dejan sin sentido un recordatorio ya programado. */
const INVALIDATES: Partial<Record<BarberAppointmentStatus, BarberReminderInvalidationCause>> = {
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
  DONE: "COMPLETED",
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "agenda.edit",
    feature: "agenda",
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const to = asString(body.to) as BarberAppointmentStatus | null;
  if (!to || !VALID.includes(to)) return jsonError("Ese estado no existe.", 400);

  const current = await prisma.barberAppointment.findFirst({
    where: { id: params.id, barbershopId: shopId },
    select: { id: true, status: true },
  });
  if (!current) return jsonError("Esa visita no existe.", 404);

  if (current.status === to) {
    const same = await prisma.barberAppointment.findUniqueOrThrow({
      where: { id: current.id },
      include: APPOINTMENT_INCLUDE,
    });
    return NextResponse.json({ appointment: toAppointmentDTO(same), remindersInvalidated: 0 });
  }

  if (!canTransition(current.status, to)) {
    return jsonError(
      `No se puede pasar de "${current.status}" a "${to}".`,
      409,
      { code: "BAD_TRANSITION", allowed: nextStatuses(current.status) },
    );
  }

  const updated = await prisma.barberAppointment.update({
    where: { id: current.id },
    data: { status: to },
    include: APPOINTMENT_INCLUDE,
  });

  const cause = INVALIDATES[to];
  const remindersInvalidated = cause
    ? await invalidateAppointmentReminders(shopId, current.id, cause)
    : 0;

  return NextResponse.json({
    appointment: toAppointmentDTO(updated),
    remindersInvalidated,
    previousStatus: current.status,
  });
}

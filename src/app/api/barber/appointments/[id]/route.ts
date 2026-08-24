// ═══════════════════════════════════════════════════════════════════════
// GET    /api/barber/appointments/[id]  → una visita
// PATCH  /api/barber/appointments/[id]  → mover / editar (arrastrar y soltar)
//
// Mover es la operación estrella de la agenda: arrastras la tarjeta a otra
// hora o a otro barbero. Aquí se valida el hueco ANTES de escribir y la
// constraint EXCLUDE de Postgres lo vuelve a validar AL escribir.
//
// M-22 (dental): al mover se INVALIDAN los recordatorios pendientes de la
// visita, para que a nadie le llegue el aviso de la hora vieja.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkAppointmentSlot,
  isBarberOverlapError,
  toAppointmentDTO,
  totalServiceMinutes,
} from "@/lib/barber/agenda";
import { isTerminalAppointmentStatus } from "@/lib/barber/types";
import {
  APPOINTMENT_INCLUDE,
  asDate,
  asString,
  asStringArray,
  invalidateAppointmentReminders,
  jsonError,
  loadSlotContext,
  openAgendaGate,
  readJson,
  resolveAppointmentClient,
  type ResolvedClient,
} from "../_server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await openAgendaGate({ permission: "agenda.view", feature: "agenda" });
  if (gate.response) return gate.response;

  const appt = await prisma.barberAppointment.findFirst({
    where: { id: params.id, barbershopId: gate.gate.shopId },
    include: APPOINTMENT_INCLUDE,
  });
  if (!appt) return jsonError("Esa visita no existe.", 404);
  return NextResponse.json({ appointment: toAppointmentDTO(appt) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "agenda.edit",
    feature: "agenda",
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { shopId, timezone } = gate.gate;

  const current = await prisma.barberAppointment.findFirst({
    where: { id: params.id, barbershopId: shopId },
    include: { services: { select: { id: true, serviceId: true } } },
  });
  if (!current) return jsonError("Esa visita no existe.", 404);

  // ── Qué se está cambiando ────────────────────────────────────────────
  const nextStart = body.startAt === undefined ? current.startAt : asDate(body.startAt);
  if (!nextStart) return jsonError("La hora de inicio no es válida.", 400);

  const nextBarberId =
    body.barberId === undefined ? current.barberId : asString(body.barberId);

  const wantsServices = body.serviceIds !== undefined;
  const nextServiceIds = wantsServices
    ? asStringArray(body.serviceIds)
    : current.services.map((s) => s.serviceId);

  const movedTime = nextStart.getTime() !== current.startAt.getTime();
  const movedBarber = nextBarberId !== current.barberId;
  const structural = movedTime || movedBarber || wantsServices;

  if (structural && isTerminalAppointmentStatus(current.status)) {
    return jsonError(
      "Esta visita ya está cerrada (completada, cancelada o no llegó). Crea una nueva.",
      409,
      { code: "TERMINAL" },
    );
  }
  if (structural && !nextBarberId) {
    return jsonError("Elige al barbero que va a atender la visita.", 400);
  }

  if (nextBarberId && movedBarber) {
    const barber = await prisma.barber.findFirst({
      where: { id: nextBarberId, barbershopId: shopId, isActive: true },
      select: { id: true },
    });
    if (!barber) return jsonError("Ese barbero no existe en tu barbería.", 404);
  }

  // ── Duración: la mandan los servicios (precio congelado aparte) ──────
  let services: { id: string; durationMin: number; price: unknown }[] = [];
  let durationMin = (current.endAt.getTime() - current.startAt.getTime()) / 60_000;
  if (wantsServices) {
    if (nextServiceIds.length === 0) return jsonError("Elige al menos un servicio.", 400);
    services = await prisma.barberService.findMany({
      where: { id: { in: nextServiceIds }, barbershopId: shopId },
      select: { id: true, durationMin: true, price: true },
    });
    if (services.length === 0) {
      return jsonError("Los servicios elegidos ya no están disponibles.", 400);
    }
    durationMin = totalServiceMinutes(services);
  }
  const nextEnd = new Date(nextStart.getTime() + durationMin * 60_000);

  // Cambiar de cliente desde el modal de edición. Solo se toca si el body
  // lo menciona: un arrastre manda únicamente hora y barbero y no debe
  // borrar el cliente de rebote (en Prisma, un undefined deja el campo como
  // estaba; un null SÍ lo borra).
  let client: ResolvedClient | null = null;
  if (body.clientId !== undefined || body.clientName !== undefined) {
    const resolved = await resolveAppointmentClient(body, shopId, gate.gate.ctx);
    if (resolved.error) return resolved.error;
    client = resolved.client;
  }

  // ── ¿Cabe? ───────────────────────────────────────────────────────────
  if (structural) {
    const slotCtx = await loadSlotContext(shopId, nextStart, nextEnd);
    const check = checkAppointmentSlot({
      startAt: nextStart,
      endAt: nextEnd,
      barberId: nextBarberId,
      timezone,
      schedules: slotCtx.schedules,
      timeOff: slotCtx.timeOff,
      appointments: slotCtx.appointments,
      excludeAppointmentId: current.id,
    });
    if (!check.ok) {
      return jsonError(check.message ?? "Ese horario no está disponible.", 409, {
        code: check.issue,
        conflictId: check.conflictId,
      });
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.barberAppointment.update({
        where: { id: current.id },
        data: {
          startAt: nextStart,
          endAt: nextEnd,
          barberId: nextBarberId,
          notes: body.notes === undefined ? undefined : asString(body.notes),
          ...(client
            ? {
                clientId: client.clientId,
                clientName: client.clientName,
                clientPhone: client.clientPhone,
              }
            : {}),
        },
      });

      if (wantsServices) {
        const keep = new Set(nextServiceIds);
        const existing = new Map(current.services.map((s) => [s.serviceId, s.id]));
        const toDelete = current.services.filter((s) => !keep.has(s.serviceId)).map((s) => s.id);
        if (toDelete.length > 0) {
          await tx.barberAppointmentService.deleteMany({ where: { id: { in: toDelete } } });
        }
        // Los servicios que ya estaban CONSERVAN su priceAtBooking: el
        // precio se congeló al reservar y no se recalcula por editar.
        const toAdd = services.filter((s) => !existing.has(s.id));
        if (toAdd.length > 0) {
          await tx.barberAppointmentService.createMany({
            data: toAdd.map((s) => ({
              appointmentId: current.id,
              serviceId: s.id,
              priceAtBooking: s.price as never,
            })),
          });
        }
      }

      return tx.barberAppointment.findUniqueOrThrow({
        where: { id: current.id },
        include: APPOINTMENT_INCLUDE,
      });
    });

    // ── M-22: el recordatorio viejo ya no vale ─────────────────────────
    let remindersInvalidated = 0;
    if (movedTime || movedBarber) {
      remindersInvalidated = await invalidateAppointmentReminders(shopId, current.id, "MOVED");
    } else if (wantsServices && durationMin !== (current.endAt.getTime() - current.startAt.getTime()) / 60_000) {
      remindersInvalidated = await invalidateAppointmentReminders(
        shopId,
        current.id,
        "SERVICES_CHANGED",
      );
    }

    return NextResponse.json({
      appointment: toAppointmentDTO(updated),
      remindersInvalidated,
      // Para el "Deshacer" del panel: dónde estaba antes de moverla.
      previous: {
        startAt: current.startAt.toISOString(),
        endAt: current.endAt.toISOString(),
        barberId: current.barberId,
      },
    });
  } catch (err) {
    if (isBarberOverlapError(err)) {
      return jsonError("Ese barbero ya tiene otra visita a esa hora.", 409, { code: "OVERLAP" });
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/schedules/timeoff  → bloquear agenda
//
// Un bloqueo puede ser de UN barbero (comida, vacaciones) o de TODA la
// barbería cuando barberId es null (día festivo). Los bloqueos tapan la
// agenda: checkAppointmentSlot() rechaza cualquier visita que los toque.
//
// Deliberado: crear un bloqueo NO se cae si ya hay visitas dentro. Se crea
// y se devuelve la lista de las que quedaron atrapadas, para que el
// mostrador las mueva. Bloquear la operación por eso obligaría a mover 8
// visitas antes de poder registrar unas vacaciones.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { blocksAgenda, toAppointmentDTO, toTimeOffDTO } from "@/lib/barber/agenda";
import type { BarberTimeOffType } from "@/lib/barber/types";
import { timeOffAllowed, timeOffScope } from "@/lib/barber/permissions";
import {
  APPOINTMENT_INCLUDE,
  asDate,
  asString,
  jsonError,
  openAgendaGate,
  readJson,
} from "../../appointments/_server";

export const dynamic = "force-dynamic";

const TYPES: BarberTimeOffType[] = ["BREAK", "VACATION", "HOLIDAY", "OTHER"];
const MAX_BLOCK_DAYS = 365;

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: ["timeoff.manage", "timeoff.own"],
    feature: "agenda",
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { ctx, shopId } = gate.gate;
  // Recepción/encargado: cualquier bloqueo. Barbero: solo los de SU ficha,
  // nunca toda la barbería (L3 ronda 2).
  const scope = timeOffScope({
    role: ctx.role,
    permissionsOverride: ctx.user.permissionsOverride,
    ownBarberId: ctx.barber?.id ?? null,
  });

  const startAt = asDate(body.startAt);
  const endAt = asDate(body.endAt);
  if (!startAt || !endAt) return jsonError("Las fechas del bloqueo no son válidas.", 400);
  if (endAt.getTime() <= startAt.getTime()) {
    return jsonError("El fin del bloqueo debe ser posterior al inicio.", 400);
  }
  if (endAt.getTime() - startAt.getTime() > MAX_BLOCK_DAYS * 86_400_000) {
    return jsonError("Un bloqueo no puede durar más de un año.", 400);
  }

  const rawType = asString(body.type) as BarberTimeOffType | null;
  const type: BarberTimeOffType = rawType && TYPES.includes(rawType) ? rawType : "OTHER";

  // barberId null = TODA la barbería cerrada. Es la semántica del schema y
  // se respeta tal cual.
  const barberId = asString(body.barberId);
  if (!timeOffAllowed(scope, barberId ?? null)) {
    return jsonError("Solo puedes bloquear tu propia agenda.", 403);
  }
  if (barberId) {
    const barber = await prisma.barber.findFirst({
      where: { id: barberId, barbershopId: shopId },
      select: { id: true },
    });
    if (!barber) return jsonError("Ese barbero no existe en tu barbería.", 404);
  }

  // Dos bloqueos idénticos (mismo barbero o toda la barbería, mismo inicio y fin) no aportan nada
  // y luego hay que quitarlos de uno en uno: se rechaza el segundo.
  const repetido = await prisma.barberTimeOff.findFirst({
    where: { barbershopId: shopId, barberId: barberId ?? null, startAt, endAt },
    select: { id: true },
  });
  if (repetido) return jsonError("Ya hay un bloqueo igual en esas fechas y horas.", 409);

  const created = await prisma.barberTimeOff.create({
    data: {
      barbershopId: shopId,
      barberId: barberId ?? null,
      startAt,
      endAt,
      reason: asString(body.reason),
      type,
      createdByUserId: ctx.barberUserId,
    },
  });

  // Visitas activas que quedaron dentro del bloqueo (aviso, no error).
  const trapped = await prisma.barberAppointment.findMany({
    where: {
      barbershopId: shopId,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(barberId ? { barberId } : {}),
    },
    include: APPOINTMENT_INCLUDE,
    orderBy: { startAt: "asc" },
    take: 50,
  });

  return NextResponse.json(
    {
      timeOff: toTimeOffDTO(created),
      trapped: trapped.filter((a) => blocksAgenda(a.status)).map(toAppointmentDTO),
    },
    { status: 201 },
  );
}

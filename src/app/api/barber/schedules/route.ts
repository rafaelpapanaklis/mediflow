// ═══════════════════════════════════════════════════════════════════════
// GET /api/barber/schedules   → horario recurrente + bloqueos + equipo
// PUT /api/barber/schedules   → reemplaza la SEMANA COMPLETA de un barbero
//
// BarberSchedule guarda minutos desde medianoche EN LA ZONA DE LA BARBERÍA
// y admite turno partido (varias filas del mismo día). Por eso el guardado
// es "reemplaza la semana de este barbero" y no "edita fila por fila": el
// editor manda la foto completa y aquí se escribe en una transacción.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mergeWindows, toBarberDTO, toScheduleDTO, toTimeOffDTO } from "@/lib/barber/agenda";
import {
  asString,
  jsonError,
  openAgendaGate,
  readJson,
} from "../appointments/_server";

export const dynamic = "force-dynamic";

/** Ventana de bloqueos que se manda al panel: un mes atrás, medio año adelante. */
const TIME_OFF_PAST_DAYS = 30;
const TIME_OFF_FUTURE_DAYS = 180;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openAgendaGate({
    permission: "agenda.view",
    feature: "agenda",
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;
  const { shopId, timezone } = gate.gate;

  const now = Date.now();
  const from = new Date(now - TIME_OFF_PAST_DAYS * 86_400_000);
  const to = new Date(now + TIME_OFF_FUTURE_DAYS * 86_400_000);

  const [barbers, schedules, timeOff] = await Promise.all([
    prisma.barber.findMany({
      where: { barbershopId: shopId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.barberSchedule.findMany({
      where: { barbershopId: shopId },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.barberTimeOff.findMany({
      where: { barbershopId: shopId, endAt: { gt: from }, startAt: { lt: to } },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return NextResponse.json({
    branchId: shopId,
    timezone,
    barbers: barbers.map(toBarberDTO),
    schedules: schedules.map(toScheduleDTO),
    timeOff: timeOff.map(toTimeOffDTO),
  });
}

interface IncomingRow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export async function PUT(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "schedule.manage",
    feature: "agenda",
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const barberId = asString(body.barberId);
  if (!barberId) return jsonError("Elige al barbero.", 400);

  const barber = await prisma.barber.findFirst({
    where: { id: barberId, barbershopId: shopId },
    select: { id: true },
  });
  if (!barber) return jsonError("Ese barbero no existe en tu barbería.", 404);

  const parsed = parseRows(body.rows);
  if ("error" in parsed) return jsonError(parsed.error, 400);

  await prisma.$transaction(async (tx) => {
    await tx.barberSchedule.deleteMany({ where: { barbershopId: shopId, barberId } });
    if (parsed.rows.length > 0) {
      await tx.barberSchedule.createMany({
        data: parsed.rows.map((r) => ({
          barbershopId: shopId,
          barberId,
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
          isActive: true,
        })),
      });
    }
  });

  const schedules = await prisma.barberSchedule.findMany({
    where: { barbershopId: shopId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
  return NextResponse.json({ schedules: schedules.map(toScheduleDTO) });
}

/**
 * Valida y normaliza las filas del editor. Las ventanas del mismo día se
 * UNEN antes de guardar: si alguien captura 9–14 y 13–20 (se encimaron por
 * error), queda 9–20 y no dos filas contradictorias.
 */
function parseRows(input: unknown): { rows: IncomingRow[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "Falta el horario de la semana." };
  if (input.length > 60) return { error: "Demasiadas franjas de horario." };

  const byDay = new Map<number, { start: number; end: number }[]>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { error: "Hay una franja con formato inválido." };
    const r = raw as Record<string, unknown>;
    const dayOfWeek = Number(r.dayOfWeek);
    const startMinute = Number(r.startMinute);
    const endMinute = Number(r.endMinute);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { error: "Día de la semana inválido." };
    }
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
      return { error: "Las horas del horario deben ser válidas." };
    }
    if (startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) {
      return { error: "La hora de cierre debe ser posterior a la de apertura." };
    }
    const list = byDay.get(dayOfWeek) ?? [];
    list.push({ start: startMinute, end: endMinute });
    byDay.set(dayOfWeek, list);
  }

  const rows: IncomingRow[] = [];
  // Array.from: el target de TS del repo no deja iterar un Map directo.
  for (const [dayOfWeek, windows] of Array.from(byDay.entries())) {
    for (const w of mergeWindows(windows)) {
      rows.push({ dayOfWeek, startMinute: w.start, endMinute: w.end });
    }
  }
  return { rows };
}

// Núcleo de la agenda y de la fila virtual (puro, sin BD).
//   npx tsx --test src/lib/barber/__tests__/agenda.test.ts
//
// Estas pruebas fijan las reglas que NO se pueden romper sin avisar:
//  · el predicado de solape es ESPEJO de la constraint EXCLUDE
//    `barber_appt_no_overlap` (sql/barber_agenda.sql). Si cambia una, la
//    otra tiene que cambiar — y esta prueba lo delata;
//  · fuera del horario del barbero, o dentro de un bloqueo, no se agenda;
//  · el WHERE que invalida recordatorios SIEMPRE lleva barbershopId (en
//    Prisma, un undefined ahí borra el filtro de inquilino).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BarberAppointmentStatus } from "../types";
import {
  addDaysISO,
  assignLanes,
  averageServiceMinutes,
  barberDayWindows,
  blocksAgenda,
  checkAppointmentSlot,
  computeGridBounds,
  estimateWaitMinutes,
  formatMinutes,
  hasAnySchedule,
  hhmmToMinute,
  isBarberOverlapError,
  isInvalidatedReminder,
  mergeWindows,
  minuteToHHMM,
  pendingReminderInvalidationWhere,
  reminderInvalidationData,
  shopDateISO,
  shopLocalToUtc,
  shopMinuteOfDay,
  snapMinute,
  startOfWeekISO,
  totalServiceMinutes,
  walkInRank,
  walkInsAhead,
  weekdayOfISO,
  type BusyAppointmentLike,
  type ScheduleLike,
  type TimeOffLike,
} from "../agenda";

const TZ = "America/Mexico_City";
const MONDAY = "2026-08-31";
const SUNDAY = addDaysISO(MONDAY, -1);

const at = (dateISO: string, hhmm: string) => shopLocalToUtc(dateISO, hhmmToMinute(hhmm)!, TZ);

// Barbero B1: lunes 10–14 y 16–20 (turno partido, con hueco de comida).
const SCHEDULES: ScheduleLike[] = [
  { barberId: "B1", dayOfWeek: 1, startMinute: 600, endMinute: 840, isActive: true },
  { barberId: "B1", dayOfWeek: 1, startMinute: 960, endMinute: 1200, isActive: true },
];

const base = {
  barberId: "B1" as string | null,
  timezone: TZ,
  schedules: SCHEDULES,
  timeOff: [] as TimeOffLike[],
  appointments: [] as BusyAppointmentLike[],
};

/** Una visita de 10:00 a 10:30 del barbero B1, en el estado que se pida. */
const busy = (status: BarberAppointmentStatus): BusyAppointmentLike[] => [
  {
    id: "A1",
    barberId: "B1",
    status,
    startAt: at(MONDAY, "10:00").toISOString(),
    endAt: at(MONDAY, "10:30").toISOString(),
  },
];

// ── Zona horaria de la barbería ────────────────────────────────────────

test("la fecha semilla de las pruebas es un lunes de verdad", () => {
  assert.equal(weekdayOfISO(MONDAY), 1);
  assert.equal(weekdayOfISO(SUNDAY), 0);
});

test("(fecha local + minuto) → UTC → (fecha local + minuto) da la vuelta completa", () => {
  const utc = shopLocalToUtc(MONDAY, 600, TZ);
  assert.equal(shopDateISO(utc, TZ), MONDAY);
  assert.equal(shopMinuteOfDay(utc, TZ), 600);
});

test("la medianoche local no se corre de día", () => {
  const utc = shopLocalToUtc(MONDAY, 0, TZ);
  assert.equal(shopDateISO(utc, TZ), MONDAY);
  assert.equal(shopMinuteOfDay(utc, TZ), 0);
});

test("la semana laboral empieza en lunes", () => {
  assert.equal(startOfWeekISO("2026-09-03"), MONDAY);
  assert.equal(startOfWeekISO(SUNDAY), addDaysISO(SUNDAY, -6));
});

test("minuteToHHMM y hhmmToMinute son inversas; una hora imposible es null", () => {
  assert.equal(minuteToHHMM(600), "10:00");
  assert.equal(hhmmToMinute("10:00"), 600);
  assert.equal(hhmmToMinute("25:00"), null);
  assert.equal(hhmmToMinute("no es hora"), null);
});

// ── Horario recurrente y turno partido ─────────────────────────────────

test("mergeWindows une lo contiguo pero respeta el turno partido", () => {
  assert.deepEqual(
    mergeWindows([
      { start: 540, end: 840 },
      { start: 840, end: 1200 },
    ]),
    [{ start: 540, end: 1200 }],
  );
  assert.equal(
    mergeWindows([
      { start: 540, end: 840 },
      { start: 960, end: 1200 },
    ]).length,
    2,
  );
});

test("barberDayWindows solo devuelve las franjas de ese barbero y ese día", () => {
  assert.equal(barberDayWindows(SCHEDULES, "B1", 1).length, 2);
  assert.equal(barberDayWindows(SCHEDULES, "B1", 0).length, 0);
  assert.equal(barberDayWindows(SCHEDULES, "B2", 1).length, 0);
});

// ── Un hueco fuera de horario o dentro de un bloqueo NO se ofrece ───────

test("dentro del turno sí se puede agendar", () => {
  const r = checkAppointmentSlot({ ...base, startAt: at(MONDAY, "10:00"), endAt: at(MONDAY, "10:30") });
  assert.equal(r.ok, true);
});

test("en el hueco de la comida no se puede agendar", () => {
  const r = checkAppointmentSlot({ ...base, startAt: at(MONDAY, "15:00"), endAt: at(MONDAY, "15:30") });
  assert.equal(r.issue, "OUTSIDE_SCHEDULE");
});

test("una visita que se pasa del cierre del turno no cabe", () => {
  const r = checkAppointmentSlot({ ...base, startAt: at(MONDAY, "13:45"), endAt: at(MONDAY, "14:15") });
  assert.equal(r.issue, "OUTSIDE_SCHEDULE");
});

test("antes de abrir no se puede agendar", () => {
  const r = checkAppointmentSlot({ ...base, startAt: at(MONDAY, "09:00"), endAt: at(MONDAY, "09:30") });
  assert.equal(r.issue, "OUTSIDE_SCHEDULE");
});

test("un día sin filas de horario es un día que ese barbero no trabaja", () => {
  const r = checkAppointmentSlot({ ...base, startAt: at(SUNDAY, "11:00"), endAt: at(SUNDAY, "11:30") });
  assert.equal(r.issue, "OUTSIDE_SCHEDULE");
});

test("un barbero SIN horario configurado no se bloquea (primer día de uso)", () => {
  assert.equal(hasAnySchedule(SCHEDULES, "B2"), false);
  const r = checkAppointmentSlot({
    ...base,
    barberId: "B2",
    startAt: at(SUNDAY, "07:00"),
    endAt: at(SUNDAY, "07:30"),
  });
  assert.equal(r.ok, true);
});

test("un bloqueo de TODA la barbería (barberId null) tapa a cualquier barbero", () => {
  const timeOff: TimeOffLike[] = [
    { id: "T1", barberId: null, startAt: at(MONDAY, "11:00").toISOString(), endAt: at(MONDAY, "12:00").toISOString() },
  ];
  const r = checkAppointmentSlot({ ...base, timeOff, startAt: at(MONDAY, "11:15"), endAt: at(MONDAY, "11:45") });
  assert.equal(r.issue, "TIME_OFF");
  assert.equal(r.conflictId, "T1");
});

test("el bloqueo de otro barbero no estorba", () => {
  const timeOff: TimeOffLike[] = [
    { id: "T2", barberId: "B9", startAt: at(MONDAY, "11:00").toISOString(), endAt: at(MONDAY, "12:00").toISOString() },
  ];
  const r = checkAppointmentSlot({ ...base, timeOff, startAt: at(MONDAY, "11:15"), endAt: at(MONDAY, "11:45") });
  assert.equal(r.ok, true);
});

test("un bloqueo que solo TOCA el borde no estorba (el intervalo es semiabierto)", () => {
  const timeOff: TimeOffLike[] = [
    { id: "T3", barberId: null, startAt: at(MONDAY, "11:00").toISOString(), endAt: at(MONDAY, "11:30").toISOString() },
  ];
  const r = checkAppointmentSlot({ ...base, timeOff, startAt: at(MONDAY, "11:30"), endAt: at(MONDAY, "12:00") });
  assert.equal(r.ok, true);
});

// ── Dos visitas encimadas del mismo barbero ────────────────────────────

test("solaparse con una visita confirmada se rechaza y se dice con cuál", () => {
  const r = checkAppointmentSlot({
    ...base,
    appointments: busy("CONFIRMED"),
    startAt: at(MONDAY, "10:15"),
    endAt: at(MONDAY, "10:45"),
  });
  assert.equal(r.issue, "OVERLAP");
  assert.equal(r.conflictId, "A1");
});

test("pegadas no es encimadas: 10:30 justo después de 10:00-10:30 sí cabe", () => {
  const r = checkAppointmentSlot({
    ...base,
    appointments: busy("CONFIRMED"),
    startAt: at(MONDAY, "10:30"),
    endAt: at(MONDAY, "11:00"),
  });
  assert.equal(r.ok, true);
});

test("una cancelada libera la silla (mismo criterio que el EXCLUDE del SQL)", () => {
  const r = checkAppointmentSlot({
    ...base,
    appointments: busy("CANCELLED"),
    startAt: at(MONDAY, "10:15"),
    endAt: at(MONDAY, "10:45"),
  });
  assert.equal(r.ok, true);
});

test("una de 'no llegó' libera la silla", () => {
  const r = checkAppointmentSlot({
    ...base,
    appointments: busy("NO_SHOW"),
    startAt: at(MONDAY, "10:15"),
    endAt: at(MONDAY, "10:45"),
  });
  assert.equal(r.ok, true);
});

test("una completada SÍ ocupa: la silla estuvo usada de verdad", () => {
  const r = checkAppointmentSlot({
    ...base,
    appointments: busy("DONE"),
    startAt: at(MONDAY, "10:15"),
    endAt: at(MONDAY, "10:45"),
  });
  assert.equal(r.ok, false);
});

test("al arrastrar, una visita no choca consigo misma", () => {
  const r = checkAppointmentSlot({
    ...base,
    appointments: busy("CONFIRMED"),
    excludeAppointmentId: "A1",
    startAt: at(MONDAY, "10:15"),
    endAt: at(MONDAY, "10:45"),
  });
  assert.equal(r.ok, true);
});

test("blocksAgenda es ESPEJO del predicado de barber_appt_no_overlap", () => {
  // WHERE ("barberId" IS NOT NULL AND "status" NOT IN ('CANCELLED','NO_SHOW'))
  for (const s of ["PENDING", "CONFIRMED", "IN_PROGRESS", "DONE"] as BarberAppointmentStatus[]) {
    assert.equal(blocksAgenda(s), true, s);
  }
  assert.equal(blocksAgenda("CANCELLED"), false);
  assert.equal(blocksAgenda("NO_SHOW"), false);
});

test("sin barbero no se agenda, y un rango invertido o vacío se rechaza", () => {
  assert.equal(
    checkAppointmentSlot({ ...base, barberId: null, startAt: at(MONDAY, "10:00"), endAt: at(MONDAY, "10:30") }).issue,
    "NO_BARBER",
  );
  assert.equal(
    checkAppointmentSlot({ ...base, startAt: at(MONDAY, "10:30"), endAt: at(MONDAY, "10:00") }).issue,
    "INVALID_RANGE",
  );
  assert.equal(
    checkAppointmentSlot({ ...base, startAt: at(MONDAY, "10:00"), endAt: at(MONDAY, "10:00") }).issue,
    "INVALID_RANGE",
  );
});

test("isBarberOverlapError reconoce el 23P01 de Postgres en sus tres formas", () => {
  assert.equal(isBarberOverlapError({ code: "P2010", meta: { code: "23P01" } }), true);
  assert.equal(isBarberOverlapError({ code: "23P01" }), true);
  assert.equal(
    isBarberOverlapError({
      message: 'conflicting key value violates exclusion constraint "barber_appt_no_overlap"',
    }),
    true,
  );
  assert.equal(isBarberOverlapError({ code: "P2002" }), false);
  assert.equal(isBarberOverlapError(null), false);
});

// ── Rejilla de la vista día / semana ───────────────────────────────────

test("la rejilla se estira para que una visita fuera de horario NO desaparezca", () => {
  const b = computeGridBounds([{ start: 600, end: 1200 }], [{ start: 420, end: 480 }]);
  assert.ok(b.start <= 420, "la rejilla debe llegar a las 7:00");
  assert.ok(b.end >= 1200);
});

test("assignLanes reparte carriles solo entre las tarjetas que se encimen", () => {
  const lanes = assignLanes([
    { start: 0, end: 60 },
    { start: 30, end: 90 },
    { start: 200, end: 260 },
  ]);
  assert.equal(lanes[0].lanes, 2);
  assert.equal(lanes[1].lanes, 2);
  assert.notEqual(lanes[0].lane, lanes[1].lane);
  assert.equal(lanes[2].lanes, 1);
});

test("snapMinute pega al múltiplo de 15 más cercano", () => {
  assert.equal(snapMinute(601), 600);
  assert.equal(snapMinute(607), 600); // 607 está a 7 del 600 y a 8 del 615
  assert.equal(snapMinute(608), 615);
});

test("la duración sale de los servicios y nunca baja de un slot", () => {
  assert.equal(totalServiceMinutes([{ durationMin: 30 }, { durationMin: 25 }]), 55);
  assert.equal(totalServiceMinutes([]), 15);
});

// ── Fila virtual ───────────────────────────────────────────────────────

const QUEUE = [
  { id: "W1", position: 1, barberId: null, status: "CALLED" as const },
  { id: "W2", position: 2, barberId: "B1", status: "WAITING" as const },
  { id: "W3", position: 3, barberId: "B2", status: "WAITING" as const },
  { id: "W4", position: 4, barberId: "B2", status: "WAITING" as const },
  { id: "W5", position: 5, barberId: null, status: "LEFT" as const },
];

test("el lugar se cuenta sobre la fila ACTIVA: quien se fue ya no ocupa", () => {
  assert.equal(walkInRank(QUEUE, "W1"), 1);
  assert.equal(walkInRank(QUEUE, "W4"), 4);
  assert.equal(walkInRank(QUEUE, "W5"), 0);
});

test("quien pidió barbero solo espera a los de ESE barbero y a los sin preferencia", () => {
  assert.equal(walkInsAhead(QUEUE, "W4"), 2); // W1 (sin preferencia) + W3 (B2)
  assert.equal(walkInsAhead(QUEUE, "W3"), 1); // solo W1
  assert.equal(walkInsAhead(QUEUE, "W2"), 1); // solo W1
});

test("quien no pide barbero espera a todos los de adelante", () => {
  const q = [...QUEUE, { id: "W6", position: 6, barberId: null, status: "WAITING" as const }];
  assert.equal(walkInsAhead(q, "W6"), 4);
});

test("la espera es promedio × gente delante / sillas, en bloques de 5", () => {
  assert.equal(estimateWaitMinutes({ ahead: 0, chairs: 3, avgServiceMin: 30 }), 0);
  assert.equal(estimateWaitMinutes({ ahead: 3, chairs: 3, avgServiceMin: 30 }), 30);
  assert.equal(estimateWaitMinutes({ ahead: 2, chairs: 1, avgServiceMin: 30 }), 60);
  assert.equal(estimateWaitMinutes({ ahead: 1, chairs: 0, avgServiceMin: 30 }), 30, "cero sillas no divide entre cero");
});

test("el promedio ignora los servicios inactivos y cae a 30 sin catálogo", () => {
  assert.equal(averageServiceMinutes([{ durationMin: 30 }, { durationMin: 50 }]), 40);
  assert.equal(averageServiceMinutes([{ durationMin: 30, isActive: false }]), 30);
  assert.equal(averageServiceMinutes([]), 30);
});

test("formatMinutes no interpreta el cero", () => {
  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(70), "1 h 10 min");
});

// ── Recordatorios: el M-22 del dental que aquí no se repite ────────────

test("el WHERE de invalidación SIEMPRE lleva barbershopId (undefined borraría el filtro)", () => {
  const w = pendingReminderInvalidationWhere("shop_1", "appt_1");
  assert.equal(w.barbershopId, "shop_1");
  assert.notEqual(w.barbershopId, undefined);
  assert.equal(w.appointmentId, "appt_1");
  assert.equal(w.direction, "OUTBOUND");
  assert.equal(w.status, "PENDING");
});

test("invalidar MARCA en vez de borrar, y la marca la reconoce quien envía", () => {
  const d = reminderInvalidationData("MOVED");
  assert.equal(d.status, "FAILED");
  assert.equal(isInvalidatedReminder(d.errorMessage), true);
  assert.equal(isInvalidatedReminder("error de red"), false);
  assert.equal(isInvalidatedReminder(null), false);
});

test("cada motivo de invalidación explica en texto por qué no salió el aviso", () => {
  for (const cause of ["MOVED", "CANCELLED", "NO_SHOW", "SERVICES_CHANGED", "COMPLETED"] as const) {
    const message = reminderInvalidationData(cause).errorMessage;
    assert.ok(message.length > 25, cause);
    assert.equal(isInvalidatedReminder(message), true, cause);
  }
});

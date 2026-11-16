// «¿Con quién?»: quién trabaja ese día y a quién se propone (lógica L1, ronda 2).
//   npx tsx --test src/lib/barber/__tests__/quien-trabaja.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { barberDayStatus, barberWorksAt, pickBarbers } from "../quien-trabaja";

const TZ = "America/Mexico_City"; // UTC−6
// Domingo 15-nov-2026 (dayOfWeek 0) y lunes 16 (1).
const DOM = "2026-11-15";
const sched = (barberId: string, dayOfWeek: number, start: number, end: number) => ({
  barberId,
  dayOfWeek,
  startMinute: start,
  endMinute: end,
  isActive: true,
});

const barbers = [
  { id: "uno", isActive: true }, // descansa el domingo
  { id: "dos", isActive: true }, // domingo 10–20, en la silla
  { id: "tres", isActive: true }, // sin horario cargado
  { id: "cuatro", isActive: true }, // domingo 10–20, libre
  { id: "cinco", isActive: true }, // domingo 16–20 (aún no entra a las 12)
  { id: "baja", isActive: false }, // dado de baja
];
const schedules = [
  sched("uno", 1, 600, 1200),
  sched("dos", 0, 600, 1200),
  sched("cuatro", 0, 600, 1200),
  sched("cinco", 0, 960, 1200),
  sched("baja", 0, 600, 1200),
];
// 15-nov 12:00 en México = 18:00 UTC.
const MEDIODIA = new Date("2026-11-15T18:00:00Z");

test("descansa = no tiene horario ese día; sin horario cargado = no se sabe (no se oculta)", () => {
  const base = { schedules, timeOff: [], dateISO: DOM, timezone: TZ };
  assert.equal(barberDayStatus({ ...base, barberId: "uno" }), "off");
  assert.equal(barberDayStatus({ ...base, barberId: "dos" }), "works");
  assert.equal(barberDayStatus({ ...base, barberId: "tres" }), "unknown");
});

test("un bloqueo de todo el día (suyo o de la barbería) lo vuelve «no trabaja»; uno parcial no", () => {
  const base = { schedules, dateISO: DOM, timezone: TZ, barberId: "dos" };
  const todoElDia = [{ barberId: "dos", startAt: "2026-11-15T06:00:00Z", endAt: "2026-11-16T06:00:00Z" }];
  assert.equal(barberDayStatus({ ...base, timeOff: todoElDia }), "off");
  const festivo = [{ barberId: null, startAt: "2026-11-15T06:00:00Z", endAt: "2026-11-16T06:00:00Z" }];
  assert.equal(barberDayStatus({ ...base, timeOff: festivo }), "off");
  const comida = [{ barberId: "dos", startAt: "2026-11-15T20:00:00Z", endAt: "2026-11-15T21:00:00Z" }];
  assert.equal(barberDayStatus({ ...base, timeOff: comida }), "works");
  // …pero en la hora de comida no está trabajando.
  assert.equal(
    barberWorksAt({ schedules, timeOff: comida, barberId: "dos", at: new Date("2026-11-15T20:30:00Z"), timezone: TZ }),
    false,
  );
});

test("se ocultan los que descansan y los dados de baja; se propone al que trabaja ahora y está libre", () => {
  const pick = pickBarbers({
    barbers,
    schedules,
    timeOff: [],
    visits: [{ barberId: "dos", status: "IN_PROGRESS" }],
    dateISO: DOM,
    timezone: TZ,
    now: MEDIODIA,
  });
  assert.deepEqual(pick.visible, ["dos", "tres", "cuatro", "cinco"]);
  assert.equal(pick.hidden, 1); // «uno» (la baja no cuenta: no está en el equipo activo)
  // «dos» está en la silla; «cuatro» trabaja ahora y está libre. «cinco» todavía no entra.
  assert.equal(pick.suggested, "cuatro");
});

test("si todos los que trabajan están ocupados ahora, el primero libre de ese día; si no, el primero que trabaja", () => {
  const ocupados = [
    { barberId: "dos", status: "IN_PROGRESS" },
    { barberId: "cuatro", status: "IN_PROGRESS" },
  ];
  const base = { barbers, schedules, timeOff: [], dateISO: DOM, timezone: TZ, now: MEDIODIA };
  // «cinco» trabaja hoy (entra a las 4) y no tiene a nadie: es el siguiente.
  assert.equal(pickBarbers({ ...base, visits: ocupados }).suggested, "cinco");
  const todos = [...ocupados, { barberId: "cinco", status: "IN_PROGRESS" }];
  assert.equal(pickBarbers({ ...base, visits: todos }).suggested, "dos");
});

test("visitas terminadas o pendientes no ocupan la silla", () => {
  const pick = pickBarbers({
    barbers,
    schedules,
    timeOff: [],
    visits: [
      { barberId: "dos", status: "COMPLETED" },
      { barberId: "dos", status: "CONFIRMED" },
    ],
    dateISO: DOM,
    timezone: TZ,
    now: MEDIODIA,
  });
  assert.equal(pick.suggested, "dos");
});

test("otro día (Nueva visita para el lunes): no importa quién está en la silla hoy", () => {
  const pick = pickBarbers({
    barbers,
    schedules,
    timeOff: [],
    visits: [{ barberId: "uno", status: "IN_PROGRESS" }],
    dateISO: "2026-11-16",
    timezone: TZ,
    now: MEDIODIA,
  });
  assert.deepEqual(pick.visible, ["uno", "tres"]);
  assert.equal(pick.suggested, "uno");
});

test("nadie con horario: se propone al primero sin horario; sin activos, a nadie", () => {
  const sinHorario = pickBarbers({
    barbers: [{ id: "a", isActive: true }, { id: "b", isActive: true }],
    schedules: [],
    timeOff: [],
    visits: [],
    dateISO: DOM,
    timezone: TZ,
    now: MEDIODIA,
  });
  assert.deepEqual(sinHorario, { visible: ["a", "b"], hidden: 0, suggested: "a" });
  const vacio = pickBarbers({ barbers: [], schedules, timeOff: [], visits: [], dateISO: DOM, timezone: TZ, now: MEDIODIA });
  assert.equal(vacio.suggested, null);
});

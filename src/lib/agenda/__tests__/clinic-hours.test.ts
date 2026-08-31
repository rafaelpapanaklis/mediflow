/**
 * Unificación agendaDayStart/End ↔ ClinicSchedule (P1-13).
 *
 * Run: npm run test:clinic-hours
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tzLocalToUtc } from "../time-utils";
import {
  ALL_SCHEDULE_DAYS,
  effectiveAgendaWindow,
  paintedAgendaWindow,
  scheduleDayOf,
  scheduleDayOfISO,
  scheduleViolation,
  type ScheduleDay,
} from "../clinic-hours";

const TZ = "America/Mexico_City";
const CLINIC = { agendaDayStart: 8, agendaDayEnd: 20 };

function week(open: string, close: string, opts: { closed?: number[] } = {}): ScheduleDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: !(opts.closed ?? []).includes(dayOfWeek),
    openTime: open,
    closeTime: close,
  }));
}

test("sin ClinicSchedule el eje queda como siempre (8–20)", () => {
  assert.deepEqual(effectiveAgendaWindow(CLINIC, []), { dayStart: 8, dayEnd: 20 });
  assert.deepEqual(effectiveAgendaWindow(CLINIC, null), { dayStart: 8, dayEnd: 20 });
});

test("clínica 07:00–21:30 → el eje se AMPLÍA a 7–22 (el caso de P1-13)", () => {
  assert.deepEqual(effectiveAgendaWindow(CLINIC, week("07:00", "21:30")), {
    dayStart: 7,
    dayEnd: 22,
  });
});

test("clínica 09:00–14:00 → el eje NO se encoge (unión, nunca esconder citas viejas)", () => {
  assert.deepEqual(effectiveAgendaWindow(CLINIC, week("09:00", "14:00")), {
    dayStart: 8,
    dayEnd: 20,
  });
});

test("días deshabilitados y horas inválidas no cuentan para el eje", () => {
  const rows: ScheduleDay[] = [
    { dayOfWeek: 0, enabled: false, openTime: "05:00", closeTime: "23:00" },
    { dayOfWeek: 1, enabled: true, openTime: "basura", closeTime: "22:00" },
    { dayOfWeek: 2, enabled: true, openTime: "10:00", closeTime: "09:00" }, // close <= open
  ];
  assert.deepEqual(effectiveAgendaWindow(CLINIC, rows), { dayStart: 8, dayEnd: 20 });
});

// 2026-08-10 es lunes → convención ClinicSchedule: dayOfWeek 0.
test("scheduleDayOf usa la convención 0=Lunes en la tz de la clínica", () => {
  assert.equal(scheduleDayOf(tzLocalToUtc("2026-08-10", 12, 0, TZ), TZ), 0); // lunes
  assert.equal(scheduleDayOf(tzLocalToUtc("2026-08-16", 12, 0, TZ), TZ), 6); // domingo
});

test("día cerrado → violación closed_day (lo que el panel nunca validaba)", () => {
  const schedules = week("09:00", "18:00", { closed: [6] }); // domingo cerrado
  const v = scheduleViolation(
    tzLocalToUtc("2026-08-16", 10, 0, TZ), // domingo
    tzLocalToUtc("2026-08-16", 10, 30, TZ),
    TZ,
    CLINIC,
    schedules,
  );
  assert.equal(v?.reason, "closed_day");
});

test("dentro del horario configurado → null (aunque esté fuera del 8–20 viejo)", () => {
  const schedules = week("07:00", "21:00");
  const v = scheduleViolation(
    tzLocalToUtc("2026-08-10", 7, 30, TZ), // 7:30 — antes bloqueado por el 8 clavado
    tzLocalToUtc("2026-08-10", 8, 0, TZ),
    TZ,
    CLINIC,
    schedules,
  );
  assert.equal(v, null);
});

test("antes de abrir / después de cerrar según el día configurado", () => {
  const schedules = week("09:00", "18:00");
  const early = scheduleViolation(
    tzLocalToUtc("2026-08-10", 8, 30, TZ),
    tzLocalToUtc("2026-08-10", 9, 0, TZ),
    TZ, CLINIC, schedules,
  );
  assert.equal(early?.reason, "before_open");
  assert.equal(early?.openTime, "09:00");

  const late = scheduleViolation(
    tzLocalToUtc("2026-08-10", 17, 45, TZ),
    tzLocalToUtc("2026-08-10", 18, 15, TZ),
    TZ, CLINIC, schedules,
  );
  assert.equal(late?.reason, "after_close");
  assert.equal(late?.closeTime, "18:00");
});

test("sin ClinicSchedule aplica el criterio viejo (agendaDayStart/End)", () => {
  const early = scheduleViolation(
    tzLocalToUtc("2026-08-10", 7, 30, TZ),
    tzLocalToUtc("2026-08-10", 8, 0, TZ),
    TZ, CLINIC, [],
  );
  assert.equal(early?.reason, "before_open");
  const ok = scheduleViolation(
    tzLocalToUtc("2026-08-10", 8, 0, TZ),
    tzLocalToUtc("2026-08-10", 8, 30, TZ),
    TZ, CLINIC, [],
  );
  assert.equal(ok, null);
});

/* ─────────────────────────────────────────────────────────────────────
 * paintedAgendaWindow — lo que el EJE dibuja (solo presentación).
 * El caso real: clínica 09:00–18:00 que pintaba 08:00–20:00, o sea 3 de
 * 12 horas de rejilla vacía. La regla dura es que estrechar el eje NO
 * puede esconder ninguna cita: las de fuera de horario existen porque el
 * alta AVISA en vez de bloquear.
 * ────────────────────────────────────────────────────────────────────── */

const FALLBACK = { dayStart: 8, dayEnd: 20 };
// 2026-08-10 lunes (dayOfWeek 0 en la convención de ClinicSchedule).
const MONDAY = "2026-08-10";
const MON = [0];

function at(dateISO: string, h: number, m = 0): string {
  return tzLocalToUtc(dateISO, h, m, TZ).toISOString();
}

function appt(dateISO: string, fromH: number, fromM: number, toH: number, toM: number) {
  return { startsAt: at(dateISO, fromH, fromM), endsAt: at(dateISO, toH, toM) };
}

function paint(
  schedules: ScheduleDay[] | null,
  appointments: { startsAt: string; endsAt?: string | null }[] = [],
  opts: { visibleDays?: readonly number[]; onlyDayISO?: string | null } = {},
) {
  return paintedAgendaWindow({
    fallback: FALLBACK,
    schedules,
    visibleDays: opts.visibleDays ?? MON,
    appointments,
    onlyDayISO: opts.onlyDayISO === undefined ? MONDAY : opts.onlyDayISO,
    timezone: TZ,
  });
}

test("el eje se CIÑE al horario real: 09:00–18:00 pinta 9–18, no 8–20", () => {
  assert.deepEqual(paint(week("09:00", "18:00")), { dayStart: 9, dayEnd: 18 });
});

test("sin ClinicSchedule utilizable el eje es el de siempre", () => {
  assert.deepEqual(paint([]), FALLBACK);
  assert.deepEqual(paint(null), FALLBACK);
  assert.deepEqual(
    paint([{ dayOfWeek: 0, enabled: true, openTime: "basura", closeTime: "18:00" }]),
    FALLBACK,
  );
});

test("cierre a las 18:30 → el eje llega a las 19 (hora entera hacia arriba)", () => {
  assert.deepEqual(paint(week("09:15", "18:30")), { dayStart: 9, dayEnd: 19 });
});

test("una cita ANTES de abrir ensancha el eje en vez de esconderla", () => {
  // 08:00 con horario 09:00–18:00: el aviso del alta la deja crear, así que
  // el eje tiene que empezar a las 8 (antes se clampeaba al slot 0 = mentía).
  assert.deepEqual(
    paint(week("09:00", "18:00"), [appt(MONDAY, 8, 0, 8, 45)]),
    { dayStart: 8, dayEnd: 18 },
  );
});

test("una cita DESPUÉS del cierre ensancha el eje hacia abajo", () => {
  assert.deepEqual(
    paint(week("09:00", "18:00"), [appt(MONDAY, 19, 0, 19, 30)]),
    { dayStart: 9, dayEnd: 20 },
  );
  // Termina en punto: no hace falta la hora siguiente.
  assert.deepEqual(
    paint(week("09:00", "18:00"), [appt(MONDAY, 18, 0, 19, 0)]),
    { dayStart: 9, dayEnd: 19 },
  );
});

test("vista Día: las citas de OTRO día del mismo lote no ensanchan nada", () => {
  const otherDay = appt("2026-08-11", 7, 0, 7, 30); // martes
  assert.deepEqual(
    paint(week("09:00", "18:00"), [otherDay]),
    { dayStart: 9, dayEnd: 18 },
  );
  // Sin filtro de día (vista Semana) esa misma cita SÍ cuenta.
  assert.deepEqual(
    paint(week("09:00", "18:00"), [otherDay], {
      visibleDays: ALL_SCHEDULE_DAYS,
      onlyDayISO: null,
    }),
    { dayStart: 7, dayEnd: 18 },
  );
});

test("vista Semana: unión de los días habilitados", () => {
  const rows: ScheduleDay[] = [
    ...week("09:00", "18:00").slice(0, 5),
    { dayOfWeek: 5, enabled: true, openTime: "08:00", closeTime: "14:00" }, // sábado
    { dayOfWeek: 6, enabled: false, openTime: "07:00", closeTime: "23:00" }, // domingo cerrado
  ];
  assert.deepEqual(
    paint(rows, [], { visibleDays: ALL_SCHEDULE_DAYS, onlyDayISO: null }),
    { dayStart: 8, dayEnd: 18 },
  );
});

test("día CERRADO: se usa el horario general como lienzo, no el 8–20", () => {
  // Domingo cerrado, resto 09:00–18:00 → el domingo se pinta 9–18.
  const rows = week("09:00", "18:00", { closed: [6] });
  assert.deepEqual(paint(rows, [], { visibleDays: [6], onlyDayISO: null }), {
    dayStart: 9,
    dayEnd: 18,
  });
});

test("todos los días deshabilitados → ventana de siempre", () => {
  const rows = week("09:00", "18:00", { closed: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(paint(rows), FALLBACK);
});

test("cita que cruza medianoche → el eje llega hasta las 24", () => {
  const crossing = {
    startsAt: at(MONDAY, 23, 30),
    endsAt: at("2026-08-11", 0, 30),
  };
  assert.deepEqual(paint(week("09:00", "18:00"), [crossing]), {
    dayStart: 9,
    dayEnd: 24,
  });
});

test("cita sin endsAt y fechas basura no rompen el eje", () => {
  assert.deepEqual(
    paint(week("09:00", "18:00"), [{ startsAt: at(MONDAY, 19, 15), endsAt: null }]),
    { dayStart: 9, dayEnd: 20 },
  );
  assert.deepEqual(
    paint(week("09:00", "18:00"), [{ startsAt: "no-es-fecha", endsAt: "tampoco" }]),
    { dayStart: 9, dayEnd: 18 },
  );
});

test("el resultado siempre es una ventana válida dentro de [0,24]", () => {
  const rows: ScheduleDay[] = [
    { dayOfWeek: 0, enabled: true, openTime: "00:00", closeTime: "23:59" },
  ];
  const w = paint(rows);
  assert.equal(w.dayStart, 0);
  assert.equal(w.dayEnd, 24);
  assert.ok(w.dayEnd > w.dayStart);
});

test("scheduleDayOfISO coincide con scheduleDayOf al mediodía", () => {
  assert.equal(scheduleDayOfISO(MONDAY, TZ), 0);
  assert.equal(scheduleDayOfISO("2026-08-16", TZ), 6); // domingo
  assert.equal(
    scheduleDayOfISO(MONDAY, TZ),
    scheduleDayOf(tzLocalToUtc(MONDAY, 12, 0, TZ), TZ),
  );
});

test("la ventana efectiva NO cambió: sigue siendo la unión de siempre", () => {
  // Doble candado: lo que lee y valida la API no se movió con este cambio.
  assert.deepEqual(effectiveAgendaWindow(CLINIC, week("09:00", "18:00")), {
    dayStart: 8,
    dayEnd: 20,
  });
});

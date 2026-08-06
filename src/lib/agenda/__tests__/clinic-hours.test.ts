/**
 * Unificación agendaDayStart/End ↔ ClinicSchedule (P1-13).
 *
 * Run: npm run test:clinic-hours
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tzLocalToUtc } from "../time-utils";
import {
  effectiveAgendaWindow,
  scheduleViolation,
  scheduleDayOf,
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

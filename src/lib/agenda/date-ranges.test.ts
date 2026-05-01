/**
 * Tests unitarios de viewRangeUtc() y calendarDayISO().
 *
 * Run: npx tsx --test src/lib/agenda/date-ranges.test.ts
 *
 * Foco crítico: garantizar que un timestamp 23:55 hora local pertenece
 * al día calendario local correspondiente, no al UTC. Antes la agenda
 * usaba ventanas desplazadas por agendaDayStart y los contadores no
 * reflejaban lo que realmente entraba en cada bucket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewRangeUtc, calendarDayISO, calendarRangeUtc } from "./date-ranges";

const TZ = "America/Mexico_City"; // UTC-6 sin DST en 2026

test("viewRangeUtc('day') cubre exactamente [00:00 tz, 24:00 tz)", () => {
  const r = viewRangeUtc("day", "2026-04-30", TZ);
  assert.equal(r.fromISO, "2026-04-30");
  assert.equal(r.toISO, "2026-04-30");
  // 2026-04-30 00:00 America/Mexico_City = 2026-04-30 06:00 UTC.
  assert.equal(r.fromUtc.toISOString(), "2026-04-30T06:00:00.000Z");
  // 2026-05-01 00:00 America/Mexico_City = 2026-05-01 06:00 UTC.
  assert.equal(r.toUtc.toISOString(), "2026-05-01T06:00:00.000Z");
});

test("una cita a las 23:59 local pertenece al día calendario local", () => {
  // 23:59 hora Mexico_City del 30/abr → 05:59 UTC del 1/mayo.
  const apptUtc = new Date("2026-05-01T05:59:00.000Z");
  assert.equal(calendarDayISO(apptUtc.toISOString(), TZ), "2026-04-30");

  const dayRange = viewRangeUtc("day", "2026-04-30", TZ);
  assert.ok(apptUtc >= dayRange.fromUtc, "cita 23:59 debe estar dentro del rango");
  assert.ok(apptUtc < dayRange.toUtc,   "cita 23:59 debe estar dentro del rango");

  // Y NO debe pertenecer al rango del día siguiente.
  const tomorrowRange = viewRangeUtc("day", "2026-05-01", TZ);
  assert.ok(apptUtc < tomorrowRange.fromUtc, "cita 23:59 NO debe contar como mañana");
});

test("viewRangeUtc('week') va de lunes 00:00 a próximo lunes 00:00 tz", () => {
  // 2026-04-30 es jueves. La semana ISO (Lun=0) va Apr 27 → May 3.
  const r = viewRangeUtc("week", "2026-04-30", TZ);
  assert.equal(r.fromISO, "2026-04-27");
  assert.equal(r.toISO,   "2026-05-03");
  assert.equal(r.fromUtc.toISOString(), "2026-04-27T06:00:00.000Z");
  assert.equal(r.toUtc.toISOString(),   "2026-05-04T06:00:00.000Z");
});

test("viewRangeUtc('month') usa grid de 42 días anclado al lunes anterior al 1", () => {
  // 2026-04-01 es miércoles → grid arranca lunes Mar 30, termina May 10.
  const r = viewRangeUtc("month", "2026-04-15", TZ);
  assert.equal(r.fromISO, "2026-03-30");
  assert.equal(r.toISO,   "2026-05-10");
  // 42 días entre fromUtc y toUtc (toUtc apunta al inicio del 11/may en tz).
  const ms = r.toUtc.getTime() - r.fromUtc.getTime();
  assert.equal(ms, 42 * 86_400_000);
});

test("viewRangeUtc('list') usa el mes calendario completo del dayISO", () => {
  const r = viewRangeUtc("list", "2026-04-15", TZ);
  assert.equal(r.fromISO, "2026-04-01");
  assert.equal(r.toISO,   "2026-04-30");
  // 30 días del mes de abril → 30 días entre los UTC bounds.
  const ms = r.toUtc.getTime() - r.fromUtc.getTime();
  assert.equal(ms, 30 * 86_400_000);
});

test("rangos nesting: day ⊂ week ⊂ month (fundamento de los contadores)", () => {
  const day = viewRangeUtc("day", "2026-04-30", TZ);
  const week = viewRangeUtc("week", "2026-04-30", TZ);
  const month = viewRangeUtc("month", "2026-04-30", TZ);

  assert.ok(week.fromUtc <= day.fromUtc, "week.from <= day.from");
  assert.ok(week.toUtc   >= day.toUtc,   "week.to   >= day.to");
  assert.ok(month.fromUtc <= week.fromUtc, "month.from <= week.from");
  assert.ok(month.toUtc   >= week.toUtc,   "month.to   >= week.to");
});

test("calendarRangeUtc directo: [from 00:00 tz, to+1 00:00 tz)", () => {
  const r = calendarRangeUtc("2026-04-27", "2026-05-03", TZ);
  assert.equal(r.fromUtc.toISOString(), "2026-04-27T06:00:00.000Z");
  assert.equal(r.toUtc.toISOString(),   "2026-05-04T06:00:00.000Z");
});

test("calendarDayISO clasifica correctamente un timestamp UTC en tz", () => {
  // 2026-05-01 03:00 UTC = 2026-04-30 21:00 Mexico_City.
  assert.equal(
    calendarDayISO("2026-05-01T03:00:00.000Z", TZ),
    "2026-04-30",
  );
  // 2026-05-01 12:00 UTC = 2026-05-01 06:00 Mexico_City.
  assert.equal(
    calendarDayISO("2026-05-01T12:00:00.000Z", TZ),
    "2026-05-01",
  );
});

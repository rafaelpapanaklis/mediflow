/**
 * Tests unitarios de viewRangeUtc(), calendarDayISO(), formatTimeInTz()
 * y assignLanes().
 *
 * Run: npm run test:agenda
 *
 * Foco crítico:
 *  - Garantizar que un timestamp 23:55 hora local pertenece al día
 *    calendario local correspondiente, no al UTC. Antes la agenda
 *    usaba ventanas desplazadas por agendaDayStart y los contadores no
 *    reflejaban lo que realmente entraba en cada bucket (Bug A+B).
 *  - Vista Lista debe ser un rolling window desde HOY, no el mes
 *    calendario completo (Bug E).
 *  - Format de hora consistente entre vistas con fallback a MX cuando
 *    la tz llega vacía (Bug D).
 *  - Lanes para citas overlapping (Bug C).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewRangeUtc,
  calendarDayISO,
  calendarRangeUtc,
  formatTimeInTz,
  formatTimeRangeInTz,
  LIST_VIEW_HORIZON_DAYS,
} from "./date-ranges";
import { assignLanes } from "./lane-layout";
import type { AgendaAppointmentDTO } from "./types";

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

test("viewRangeUtc('list') es rolling 30 días desde dayISO (Bug E)", () => {
  // El provider pasa todayInTz(tz) como dayISO para list. El rango debe
  // empezar EN ese día (no en el primer día del mes) y extender 30 días.
  const r = viewRangeUtc("list", "2026-05-01", TZ);
  assert.equal(r.fromISO, "2026-05-01");
  assert.equal(r.toISO,   "2026-05-31");
  const ms = r.toUtc.getTime() - r.fromUtc.getTime();
  assert.equal(ms, (LIST_VIEW_HORIZON_DAYS + 1) * 86_400_000);
});

test("viewRangeUtc('list') NO incluye días anteriores al dayISO", () => {
  // Si hoy es 1/may, NO deben verse citas del 14/abr aunque estén en
  // BD. El rango UTC debe empezar exactamente en el inicio del 1/may MX.
  const r = viewRangeUtc("list", "2026-05-01", TZ);
  // 1/may 00:00 MX = 1/may 06:00 UTC.
  assert.equal(r.fromUtc.toISOString(), "2026-05-01T06:00:00.000Z");
  // Una cita del 30/abr 23:59 MX (= 1/may 05:59 UTC) NO entra.
  const lateApr = new Date("2026-05-01T05:59:00.000Z");
  assert.ok(lateApr < r.fromUtc, "cita del 30/abr no debe estar en list de mayo");
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

/* ───────────────────── formatTimeInTz (Bug D) ───────────────────── */

test("formatTimeInTz convierte UTC a hora local MX correctamente", () => {
  // 09:00 MX = 15:00 UTC (UTC-6 sin DST).
  assert.equal(formatTimeInTz("2026-05-01T15:00:00.000Z", TZ), "09:00");
  // 11:30 MX = 17:30 UTC.
  assert.equal(formatTimeInTz("2026-05-01T17:30:00.000Z", TZ), "11:30");
  // 23:55 MX = 05:55 UTC del día siguiente.
  assert.equal(formatTimeInTz("2026-05-02T05:55:00.000Z", TZ), "23:55");
});

test("formatTimeInTz cae a 'America/Mexico_City' cuando tz es vacío (Bug D)", () => {
  // Sin fallback, Intl con timeZone undefined usa runtime default (UTC
  // en Vercel SSR) y mostraría "15:00" en vez de "09:00" → causa raíz
  // del offset -6h reportado en vista Mes.
  assert.equal(formatTimeInTz("2026-05-01T15:00:00.000Z", ""), "09:00");
  assert.equal(formatTimeInTz("2026-05-01T15:00:00.000Z", null), "09:00");
  assert.equal(formatTimeInTz("2026-05-01T15:00:00.000Z", undefined), "09:00");
});

test("formatTimeRangeInTz produce 'HH:mm–HH:mm'", () => {
  assert.equal(
    formatTimeRangeInTz("2026-05-01T15:00:00.000Z", "2026-05-01T16:00:00.000Z", TZ),
    "09:00–10:00",
  );
  assert.equal(
    formatTimeRangeInTz("2026-05-01T15:00:00.000Z", null, TZ),
    "09:00",
  );
});

/* ───────────────────── assignLanes (Bug C) ───────────────────── */

function mkAppt(id: string, startISO: string, endISO: string): AgendaAppointmentDTO {
  return {
    id,
    startsAt: startISO,
    endsAt: endISO,
    status: "SCHEDULED",
    patient: { id: `p-${id}`, name: `Paciente ${id}` },
    doctor: undefined,
    reason: undefined,
    isTeleconsult: false,
    isWalkIn: false,
    minutesWaiting: undefined,
    resourceId: null,
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
  };
}

test("assignLanes: cita única → lane 0, count 1", () => {
  const r = assignLanes([mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z")]);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.lane, 0);
  assert.equal(r[0]!.laneCount, 1);
});

test("assignLanes: dos citas overlap exacto → 2 lanes", () => {
  const r = assignLanes([
    mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z"),
    mkAppt("B", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z"),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0]!.laneCount, 2);
  assert.equal(r[1]!.laneCount, 2);
  const lanes = new Set(r.map((s) => s.lane));
  assert.equal(lanes.size, 2);
});

test("assignLanes: tres citas overlap encadenado → 3 lanes uniformes", () => {
  // A 09:00-10:00, B 09:30-10:30, C 09:45-10:15 → todas overlap entre sí.
  const r = assignLanes([
    mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z"),
    mkAppt("B", "2026-05-01T15:30:00Z", "2026-05-01T16:30:00Z"),
    mkAppt("C", "2026-05-01T15:45:00Z", "2026-05-01T16:15:00Z"),
  ]);
  assert.equal(r.length, 3);
  for (const s of r) assert.equal(s.laneCount, 3);
  assert.deepEqual(new Set(r.map((s) => s.lane)), new Set([0, 1, 2]));
});

test("assignLanes: citas contiguas (sin overlap) → cada una en lane 0, count 1", () => {
  // A 09:00-10:00, B 10:00-11:00 → no overlap (B arranca cuando A
  // termina).
  const r = assignLanes([
    mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z"),
    mkAppt("B", "2026-05-01T16:00:00Z", "2026-05-01T17:00:00Z"),
  ]);
  for (const s of r) {
    assert.equal(s.lane, 0);
    assert.equal(s.laneCount, 1);
  }
});

test("assignLanes: cita corta libera su lane para una nueva en el cluster", () => {
  // A 09:00-10:00 lane 0
  // B 09:30-11:00 lane 1
  // C 10:15-10:45 → A ya terminó a 10:00, lane 0 libre → C va a lane 0.
  // Cluster = {A, B, C}, maxLane = 1, laneCount = 2.
  const r = assignLanes([
    mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z"),
    mkAppt("B", "2026-05-01T15:30:00Z", "2026-05-01T17:00:00Z"),
    mkAppt("C", "2026-05-01T16:15:00Z", "2026-05-01T16:45:00Z"),
  ]);
  for (const s of r) assert.equal(s.laneCount, 2);
  const byId = new Map(r.map((s) => [s.appt.id, s.lane]));
  assert.equal(byId.get("A"), 0);
  assert.equal(byId.get("B"), 1);
  assert.equal(byId.get("C"), 0);
});

test("assignLanes: ignora citas CANCELLED", () => {
  const cancelled = mkAppt("X", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z");
  cancelled.status = "CANCELLED";
  const r = assignLanes([
    cancelled,
    mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.appt.id, "A");
  assert.equal(r[0]!.laneCount, 1);
});

test("assignLanes: cita sin endsAt usa fallbackDurationMin", () => {
  const a = mkAppt("A", "2026-05-01T15:00:00Z", "2026-05-01T16:00:00Z");
  const b = mkAppt("B", "2026-05-01T15:30:00Z", "2026-05-01T15:30:00Z");
  // endsAt es opcional en el DTO. Quitarlo simula una cita guardada
  // sin endsAt explícito; el helper extiende a startsAt + fallback.
  delete (b as { endsAt?: string }).endsAt;
  // A 15:00-16:00, B 15:30 + 30min fallback = 15:30-16:00 → overlap.
  const r = assignLanes([a, b], 30);
  assert.equal(r.length, 2);
  for (const s of r) assert.equal(s.laneCount, 2);
});

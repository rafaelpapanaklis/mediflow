/* ═══════════════════════════════════════════════════════════════════════
   VENTANA DE LA CITA (mockup B): recorrido, «suele volver», su próxima,
   anticipo y rutas de ws6-t5.

     npx tsx --test "src/components/barber/agenda/__tests__/cita-core.test.ts"

   México (Ciudad de México) es UTC-6 todo el año desde 2022.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shopDateISO, shopMinuteOfDay } from "@/lib/barber/agenda";
import type { BarberScheduleDTO } from "@/lib/barber/types";
import {
  cancelReasonText,
  citaSteps,
  depositBody,
  addMonthsISO,
  calendarDayState,
  closedWeekdays,
  findNextVisitSlot,
  findNextVisitSlotOnDate,
  monthGrid,
  NEXT_VISIT_MAX_DAYS,
  nextVisitOptions,
  parseDepositAmount,
  routeSupports,
  usualReturnWeeks,
  type DayWindow,
} from "../cita-core";

const TZ = "America/Mexico_City";
/** Hora local de CDMX → ISO UTC. */
const mx = (dateISO: string, hhmm: string) => {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 6, m)).toISOString();
};
const hhmm = (d: Date) => {
  const m = shopMinuteOfDay(d, TZ);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// ── Recorrido ───────────────────────────────────────────────────────────
test("recorrido: confirmada → pendiente hecha, confirmada ahora, el resto por venir", () => {
  assert.deepEqual(
    citaSteps("CONFIRMED")?.map((s) => s.state),
    ["done", "now", "next", "next"],
  );
});
test("recorrido: completada sale toda hecha", () => {
  assert.deepEqual(citaSteps("DONE")?.map((s) => s.state), ["done", "done", "done", "done"]);
});
test("recorrido: cancelada y no llegó no tienen recorrido", () => {
  assert.equal(citaSteps("CANCELLED"), null);
  assert.equal(citaSteps("NO_SHOW"), null);
});

// ── Suele volver ────────────────────────────────────────────────────────
test("suele volver: mediana de intervalos en semanas", () => {
  const v = ["2026-08-01", "2026-08-22", "2026-09-12", "2026-10-10"].map((d) => mx(d, "12:00"));
  // intervalos 21, 21, 28 → mediana 21 → 3 semanas
  assert.equal(usualReturnWeeks(v, TZ), 3);
});
test("suele volver: con menos de 3 visitas no se afirma nada", () => {
  assert.equal(usualReturnWeeks([mx("2026-08-01", "12:00"), mx("2026-08-22", "12:00")], TZ), null);
});
test("suele volver: dos visitas el mismo día cuentan como una", () => {
  const v = [mx("2026-08-01", "10:00"), mx("2026-08-01", "18:00"), mx("2026-08-15", "12:00")];
  assert.equal(usualReturnWeeks(v, TZ), null);
});
test("suele volver: más de 12 semanas no es un ritmo", () => {
  const v = ["2025-01-01", "2025-06-01", "2025-11-01"].map((d) => mx(d, "12:00"));
  assert.equal(usualReturnWeeks(v, TZ), null);
});
test("opciones: 2/3/4 y el ritmo propio si es otro", () => {
  assert.deepEqual(nextVisitOptions(null), [2, 3, 4]);
  assert.deepEqual(nextVisitOptions(3), [2, 3, 4]);
  assert.deepEqual(nextVisitOptions(6), [2, 3, 4, 6]);
});

// ── Su próxima ──────────────────────────────────────────────────────────
// Visita del domingo 15-nov-2026, 15:00–15:30 con «lalo». En 3 semanas = 6-dic (domingo, día 0).
const appt = { startAt: mx("2026-11-15", "15:00"), endAt: mx("2026-11-15", "15:30"), barberId: "lalo" };
const NOW = new Date(mx("2026-11-15", "13:47"));
const turno = (barberId: string, dayOfWeek: number, from: number, to: number): BarberScheduleDTO => ({
  id: `${barberId}-${dayOfWeek}`,
  barberId,
  dayOfWeek,
  startMinute: from,
  endMinute: to,
  isActive: true,
});
const base = (): DayWindow => ({
  barbers: [
    { id: "lalo", isActive: true },
    { id: "beto", isActive: true },
  ],
  schedules: [turno("lalo", 0, 10 * 60, 19 * 60), turno("beto", 0, 10 * 60, 19 * 60)],
  timeOff: [],
  appointments: [],
});

test("su próxima: misma hora y barbero libres → esa", () => {
  const r = findNextVisitSlot({ appointment: appt, weeks: 3, timezone: TZ, day: base(), now: NOW });
  assert.ok(r);
  assert.equal(r.dateISO, "2026-12-06");
  assert.ok(r.exact);
  assert.equal(hhmm(r.exact.startAt), "15:00");
  assert.equal(shopDateISO(r.exact.startAt, TZ), "2026-12-06");
  assert.equal(r.exact.barberId, "lalo");
});

test("su próxima: ocupada → los 3 huecos más cercanos, en orden de hora", () => {
  const day = base();
  day.appointments.push({ barberId: "lalo", startAt: mx("2026-12-06", "14:30"), endAt: mx("2026-12-06", "15:45"), status: "CONFIRMED" });
  const r = findNextVisitSlot({ appointment: appt, weeks: 3, timezone: TZ, day, now: NOW });
  assert.ok(r);
  assert.equal(r.exact, null);
  // Libres cerca: 14:00 (termina 14:30) y 15:45, 16:00…
  assert.deepEqual(r.nearby.map((s) => hhmm(s.startAt)), ["14:00", "15:45", "16:00"]);
});

test("su próxima: la visita de OTRO barbero no estorba; una cancelada tampoco", () => {
  const day = base();
  day.appointments.push({ barberId: "beto", startAt: mx("2026-12-06", "15:00"), endAt: mx("2026-12-06", "16:00"), status: "CONFIRMED" });
  day.appointments.push({ barberId: "lalo", startAt: mx("2026-12-06", "15:00"), endAt: mx("2026-12-06", "16:00"), status: "CANCELLED" });
  const r = findNextVisitSlot({ appointment: appt, weeks: 3, timezone: TZ, day, now: NOW });
  assert.ok(r?.exact);
});

test("su próxima: bloqueo de barbería entera tapa el día", () => {
  const day = base();
  day.timeOff.push({
    id: "t", barberId: null, startAt: mx("2026-12-06", "00:00"), endAt: mx("2026-12-07", "00:00"),
    reason: null, type: "HOLIDAY", createdByUserId: "u",
  });
  const r = findNextVisitSlot({ appointment: appt, weeks: 3, timezone: TZ, day, now: NOW });
  assert.ok(r);
  assert.equal(r.exact, null);
  assert.equal(r.nearby.length, 0);
});

test("su próxima: el barbero no trabaja ese día → sin huecos", () => {
  const day = base();
  day.schedules = [turno("lalo", 1, 600, 1140)];
  const r = findNextVisitSlot({ appointment: appt, weeks: 3, timezone: TZ, day, now: NOW });
  assert.equal(r?.exact, null);
  assert.equal(r?.nearby.length, 0);
});

test("su próxima: barbero dado de baja → sin huecos", () => {
  const day = base();
  day.barbers = [{ id: "lalo", isActive: false }];
  const r = findNextVisitSlot({ appointment: appt, weeks: 3, timezone: TZ, day, now: NOW });
  assert.equal(r?.exact, null);
  assert.equal(r?.nearby.length, 0);
});

test("su próxima: visita sin barbero → no se adivina", () => {
  const r = findNextVisitSlot({ appointment: { ...appt, barberId: null }, weeks: 3, timezone: TZ, day: base(), now: NOW });
  assert.equal(r, null);
});

test("su próxima: respeta la duración (una de 60 min no cabe en un hueco de 30)", () => {
  const largo = { ...appt, endAt: mx("2026-11-15", "16:00") };
  const day = base();
  day.appointments.push({ barberId: "lalo", startAt: mx("2026-12-06", "15:30"), endAt: mx("2026-12-06", "16:00"), status: "PENDING" });
  const r = findNextVisitSlot({ appointment: largo, weeks: 3, timezone: TZ, day, now: NOW });
  assert.equal(r?.exact, null);
  assert.ok(r?.nearby.every((s) => hhmm(s.startAt) !== "15:00"));
});

// ── «Otra fecha»: el calendario de su próxima (ws6-t8) ──────────────────
// «si quiere en 5 semanas no se puede» → domingo 20-dic-2026.
const t5 = "2026-12-20";

test("otra fecha: el día elegido propone la MISMA hora y el MISMO barbero", () => {
  const r = findNextVisitSlotOnDate({ appointment: appt, dateISO: t5, timezone: TZ, day: base(), now: NOW });
  assert.ok(r?.exact);
  assert.equal(r.dateISO, t5);
  assert.equal(hhmm(r.exact.startAt), "15:00");
  assert.equal(shopDateISO(r.exact.startAt, TZ), t5);
  assert.equal(r.exact.barberId, "lalo");
});

test("otra fecha: ocupado a esa hora → los huecos más cercanos de ESE día", () => {
  const day = base();
  day.appointments.push({ barberId: "lalo", startAt: mx(t5, "14:30"), endAt: mx(t5, "15:45"), status: "CONFIRMED" });
  const r = findNextVisitSlotOnDate({ appointment: appt, dateISO: t5, timezone: TZ, day, now: NOW });
  assert.equal(r?.exact, null);
  assert.deepEqual(r?.nearby.map((s) => hhmm(s.startAt)), ["14:00", "15:45", "16:00"]);
  assert.ok(r?.nearby.every((s) => shopDateISO(s.startAt, TZ) === t5 && s.barberId === "lalo"));
});

test("otra fecha: un lunes usa el turno del lunes, no el del día de la visita", () => {
  const day = base();
  day.schedules.push(turno("lalo", 1, 16 * 60, 20 * 60)); // lunes solo por la tarde
  const r = findNextVisitSlotOnDate({ appointment: appt, dateISO: "2026-12-21", timezone: TZ, day, now: NOW });
  assert.equal(r?.exact, null, "a las 15:00 aún no entra");
  assert.deepEqual(r?.nearby.map((s) => hhmm(s.startAt)), ["16:00", "16:15", "16:30"]);
});

test("otra fecha: HOY solo propone lo que todavía no pasó", () => {
  const r = findNextVisitSlotOnDate({ appointment: appt, dateISO: "2026-11-15", timezone: TZ, day: base(), now: NOW });
  assert.ok(r);
  const todos = [r.exact, ...r.nearby].filter(Boolean).map((s) => s!.startAt.getTime());
  assert.ok(todos.every((ms) => ms > NOW.getTime()));
});

test("otra fecha: con semanas da lo mismo que el día elegido a mano", () => {
  const porSemanas = findNextVisitSlot({ appointment: appt, weeks: 5, timezone: TZ, day: base(), now: NOW });
  const porDia = findNextVisitSlotOnDate({ appointment: appt, dateISO: t5, timezone: TZ, day: base(), now: NOW });
  assert.deepEqual(porSemanas, porDia);
});

test("calendario: días que la barbería cierra = ningún barbero activo trabaja", () => {
  const s = [turno("lalo", 2, 600, 1140), turno("beto", 3, 600, 1140), { ...turno("beto", 4, 600, 1140), isActive: false }, turno("ido", 5, 600, 1140)];
  const barbers = [{ id: "lalo", isActive: true }, { id: "beto", isActive: true }, { id: "ido", isActive: false }];
  assert.deepEqual([...closedWeekdays(s, barbers)].sort(), [0, 1, 4, 5, 6]);
  // Sin horario cargado no se apaga nada (no un calendario muerto).
  assert.equal(closedWeekdays([], barbers).size, 0);
});

test("calendario: pasado, cerrado, demasiado lejos y abierto", () => {
  const closed = new Set([1]); // lunes
  const today = "2026-11-15";
  assert.equal(calendarDayState({ dateISO: "2026-11-14", todayISO: today, closed }), "past");
  assert.equal(calendarDayState({ dateISO: today, todayISO: today, closed }), "open");
  assert.equal(calendarDayState({ dateISO: "2026-11-16", todayISO: today, closed }), "closed");
  assert.equal(calendarDayState({ dateISO: t5, todayISO: today, closed }), "open");
  assert.equal(NEXT_VISIT_MAX_DAYS, 365);
  assert.equal(calendarDayState({ dateISO: "2027-11-15", todayISO: today, closed: new Set() }), "open");
  assert.equal(calendarDayState({ dateISO: "2027-11-16", todayISO: today, closed: new Set() }), "far");
});

test("calendario: la rejilla del mes empieza en lunes", () => {
  const nov = monthGrid("2026-11"); // 1-nov-2026 es domingo
  assert.equal(nov[0].length, 7);
  assert.deepEqual(nov[0], [null, null, null, null, null, null, "2026-11-01"]);
  assert.equal(nov.flat().filter(Boolean).length, 30);
  assert.equal(nov.at(-1)?.[0], "2026-11-30");
  const feb = monthGrid("2027-02"); // 1-feb-2027 es lunes, 28 días: 4 semanas justas
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0], "2027-02-01");
  assert.equal(addMonthsISO("2026-12", 1), "2027-01");
  assert.equal(addMonthsISO("2026-01", -1), "2025-12");
});

// ── Anticipo ────────────────────────────────────────────────────────────
test("anticipo: montos válidos, en centavos exactos", () => {
  assert.equal(parseDepositAmount("150", null), 150);
  assert.equal(parseDepositAmount("$1,200.50", null), 1200.5);
  assert.equal(parseDepositAmount("0.10", null), 0.1);
  assert.equal(parseDepositAmount("99.99", 100), 99.99);
});
test("anticipo: basura, cero, negativos y más de 2 decimales → null", () => {
  for (const raw of ["", "abc", "0", "-50", "10.555", "1e3", "12.3.4"]) {
    assert.equal(parseDepositAmount(raw, null), null, raw);
  }
});
test("anticipo: nunca mayor que el total de la cita", () => {
  assert.equal(parseDepositAmount("180.01", 180), null);
  assert.equal(parseDepositAmount("180", 180), 180);
});

// ── Rutas de ws6-t5 ─────────────────────────────────────────────────────
test("ruta: 404 = no existe todavía; Allow manda sobre el método", () => {
  assert.equal(routeSupports(404, null, "POST"), false);
  assert.equal(routeSupports(204, "OPTIONS, POST, DELETE", "POST"), true);
  assert.equal(routeSupports(204, "OPTIONS, POST", "PATCH"), false);
  assert.equal(routeSupports(204, null, "POST"), true);
  assert.equal(routeSupports(500, null, "POST"), false);
});

// ── Motivo ──────────────────────────────────────────────────────────────
test("motivo: elegido, escrito, los dos o ninguno", () => {
  assert.equal(cancelReasonText(null, "  "), null);
  assert.equal(cancelReasonText("El cliente canceló", ""), "El cliente canceló");
  assert.equal(cancelReasonText(null, "Se enfermó"), "Se enfermó");
  assert.equal(cancelReasonText("El cliente canceló", "Se enfermó"), "El cliente canceló · Se enfermó");
  assert.equal(cancelReasonText(null, "x".repeat(300))?.length, 200);
});

test("anticipo: el cuerpo que manda la ventana lo acepta el servidor (paymentMethod, no method)", async () => {
  const { isCounterPaymentMethod } = await import("@/lib/barber/payments-core");
  for (const m of ["CASH", "CARD", "SPEI"]) {
    const body = depositBody(50, m);
    assert.equal(isCounterPaymentMethod(body.paymentMethod), true, m);
    assert.equal(body.amount, 50);
    assert.equal("method" in body, false);
  }
});

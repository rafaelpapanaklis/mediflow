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
  findNextVisitSlot,
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

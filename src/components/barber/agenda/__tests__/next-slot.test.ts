/* ═══════════════════════════════════════════════════════════════════════
   «NUEVA VISITA» PROPONE EL SIGUIENTE HUECO DE LA REJILLA, NO EL MINUTO.

     npx tsx --test "src/components/barber/agenda/__tests__/next-slot.test.ts"

   México (Ciudad de México) es UTC-6 todo el año desde 2022.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shopMinuteOfDay } from "@/lib/barber/agenda";
import { nextSlotStart } from "../next-slot";

const TZ = "America/Mexico_City";
/** Una hora local de CDMX → instante UTC (UTC-6). */
const mx = (hhmm: string, seconds = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 14, h + 6, m, seconds));
};
const local = (d: Date) => {
  const m = shopMinuteOfDay(d, TZ);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

test("18:37 → 18:45", () => assert.equal(local(nextSlotStart(mx("18:37"), TZ)), "18:45"));
test("18:46 → 19:00", () => assert.equal(local(nextSlotStart(mx("18:46"), TZ), ), "19:00"));
test("18:45 en punto se queda en 18:45", () => {
  assert.equal(local(nextSlotStart(mx("18:45"), TZ)), "18:45");
});
test("18:45:30 ya pasó el hueco: 19:00", () => {
  assert.equal(local(nextSlotStart(mx("18:45", 30), TZ)), "19:00");
});
test("nunca trae segundos", () => {
  const d = nextSlotStart(mx("10:07", 41), TZ);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});
test("con rejilla de 5 minutos: 18:37 → 18:40", () => {
  assert.equal(local(nextSlotStart(mx("18:37"), TZ, 5)), "18:40");
});
test("23:50 no salta a mañana: se queda en 23:45", () => {
  const out = nextSlotStart(mx("23:50"), TZ);
  assert.equal(local(out), "23:45");
});

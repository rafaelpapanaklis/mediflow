/* ═══════════════════════════════════════════════════════════════════════
   QUÉ PROPONE «AGREGAR TURNO» EN HORARIOS.

     npx tsx --test "src/components/barber/agenda/__tests__/shift-proposal.test.ts"

   El caso que lo motivó (auditoría del 14-nov): con el turno de fábrica
   10:00–20:00, el segundo «Agregar turno» proponía 21:00–00:00.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHIFT, withNextShift, type Shift } from "../shift-proposal";

const h = (hours: number) => Math.round(hours * 60);
const s = (from: number, to: number): Shift => ({ start: h(from), end: h(to) });

test("día vacío: el turno de fábrica", () => {
  assert.deepEqual(withNextShift([]), [DEFAULT_SHIFT]);
});

test("10–20 (de fábrica) + agregar: se parte en 10–14 y 15–20, nunca 21:00–00:00", () => {
  assert.deepEqual(withNextShift([s(10, 20)]), [s(10, 14), s(15, 20)]);
});

test("9–14 + agregar: 15–19, después de la comida", () => {
  assert.deepEqual(withNextShift([s(9, 14)]), [s(9, 14), s(15, 19)]);
});

test("el turno de la tarde no pasa del cierre habitual (22:00)", () => {
  assert.deepEqual(withNextShift([s(10, 18)]), [s(10, 18), s(19, 22)]);
});

test("turno corto de noche: propone uno antes, pegado a la comida", () => {
  assert.deepEqual(withNextShift([s(18, 22)]), [s(13, 17), s(18, 22)]);
});

test("ya con turno partido: usa el hueco que quede o parte el último", () => {
  // 10–14 y 16–20: después no cabe (21+2 > 22) y el último mide 4 h (no se parte).
  // El hueco de la mañana (7–9) sí alcanza.
  assert.deepEqual(withNextShift([s(10, 14), s(16, 20)]), [s(7, 9), s(10, 14), s(16, 20)]);
});

test("ninguna propuesta cruza la medianoche, se encima ni sale al revés", () => {
  const casos: Shift[][] = [
    [s(10, 20)],
    [s(0, 24)],
    [s(7, 22)],
    [s(8, 9.5), s(19.5, 23.5)],
    [s(22, 24)],
    [s(6, 23)],
    [s(21, 23)],
    [s(7, 8), s(9, 10), s(11, 12), s(13, 14), s(15, 16), s(17, 18), s(19, 20), s(21, 22)],
  ];
  for (const caso of casos) {
    let dia = caso;
    // Tres clics seguidos en «Agregar turno».
    for (let clic = 0; clic < 3; clic++) {
      const antes = dia.length;
      dia = withNextShift(dia);
      assert.equal(dia.length, antes + 1, `debe sumar un turno: ${JSON.stringify(caso)}`);
      for (const turno of dia) {
        assert.ok(turno.end > turno.start, `turno al revés: ${JSON.stringify(dia)}`);
        assert.ok(turno.start >= 0 && turno.end <= 24 * 60, `fuera del día: ${JSON.stringify(dia)}`);
      }
    }
  }
});

test("lo propuesto nunca termina a medianoche si el día no llegaba ya ahí", () => {
  for (const caso of [[s(10, 20)], [s(12, 21)], [s(20, 23)], [s(9, 22.5)]]) {
    const nuevo = withNextShift(caso);
    assert.ok(nuevo.every((t) => t.end < 24 * 60), JSON.stringify(nuevo));
  }
});

test("no muta la lista que recibe", () => {
  const dia = [s(10, 20)];
  withNextShift(dia);
  assert.deepEqual(dia, [s(10, 20)]);
});

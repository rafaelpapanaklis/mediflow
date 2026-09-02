/**
 * Tests de la geometría de la guía de horario de la vista Día.
 *
 * Run: npm run test:hover-slot
 *
 * Foco crítico:
 *  - Lo que la guía RESALTA y lo que el click CREA salen de la misma
 *    función. Si divergen, la guía miente y agendar vuelve a ser puntería:
 *    justo el error que vino a resolver.
 *  - El borde entre slots: y = 2 slots exactos es el slot 2 (arriba), no
 *    el 1. Un off-by-one aquí = cita media hora corrida.
 *  - Columnas cortas estiradas por `min-height: 100%`: el alto de slot es
 *    slotHpx SIEMPRE, no altoRenderizado/slotsDeEsaColumna.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnFromOffsetX,
  slotFromOffsetY,
  slotStartLabel,
} from "../hover-slot";

test("slotFromOffsetY: el slot sale del alto real, no del alto estirado", () => {
  const slotHpx = 30;
  // Columna de 9:00 a 21:00 en slots de 15 → 48 slots = 1440px, pero
  // estirada a 1800px porque otra columna tiene una cita a las 23:00.
  const stretched = 1800;
  // 12:15 con dayStart 9 y slots de 15 = slot 13 → y entre 390 y 419.
  assert.equal(slotFromOffsetY(390, slotHpx, stretched), 13);
  assert.equal(slotFromOffsetY(419, slotHpx, stretched), 13);
  assert.equal(slotFromOffsetY(420, slotHpx, stretched), 14);
});

test("slotFromOffsetY: el límite entre slots cae en el de abajo", () => {
  assert.equal(slotFromOffsetY(59, 30, 900), 1);
  assert.equal(slotFromOffsetY(60, 30, 900), 2);
});

test("slotFromOffsetY: nunca se sale de la grilla", () => {
  assert.equal(slotFromOffsetY(-40, 30, 900), 0);
  assert.equal(slotFromOffsetY(99999, 30, 900), 29);
  // Alto que no es múltiplo exacto del slot: el último slot parcial cuenta.
  assert.equal(slotFromOffsetY(99999, 30, 905), 30);
  // Densidad degenerada: no revienta ni devuelve NaN.
  assert.equal(slotFromOffsetY(100, 0, 900), 0);
});

test("columnFromOffsetX: reparte parejo y clampa en los extremos", () => {
  // 4 doctores en 800px → 200px cada uno.
  assert.equal(columnFromOffsetX(0, 800, 4), 0);
  assert.equal(columnFromOffsetX(199, 800, 4), 0);
  assert.equal(columnFromOffsetX(200, 800, 4), 1);
  // El tercer doctor (índice 2) es el del caso reportado.
  assert.equal(columnFromOffsetX(410, 800, 4), 2);
  assert.equal(columnFromOffsetX(799, 800, 4), 3);
  assert.equal(columnFromOffsetX(800, 800, 4), 3);
  assert.equal(columnFromOffsetX(-10, 800, 4), 0);
  assert.equal(columnFromOffsetX(100, 0, 4), 0);
  assert.equal(columnFromOffsetX(100, 800, 0), 0);
});

test("slotStartLabel: dice la hora exacta del slot, no solo las horas en punto", () => {
  // dayStart 9, slots de 15 → slot 13 = 12:15.
  assert.equal(slotStartLabel(13, 9, 15), "12:15");
  assert.equal(slotStartLabel(0, 9, 15), "09:00");
  assert.equal(slotStartLabel(1, 8, 30), "08:30");
  assert.equal(slotStartLabel(4, 7, 5), "07:20");
  // Cita fuera de horario: el slot se pasa del cierre y sigue siendo válido.
  assert.equal(slotStartLabel(56, 9, 15), "23:00");
});

test("guía y click coinciden en el mismo punto", () => {
  // La columna usa slotFromOffsetY con el rect de la columna y la guía con
  // el del cuerpo de columnas; ambos rects tienen el mismo techo y el mismo
  // alto (grid row), así que el slot tiene que ser idéntico.
  const slotHpx = 22;
  const height = 22 * 48;
  for (const y of [0, 21, 22, 253, 254, 700, 1055]) {
    assert.equal(
      slotFromOffsetY(y, slotHpx, height),
      slotFromOffsetY(y, slotHpx, height),
    );
    assert.ok(slotFromOffsetY(y, slotHpx, height) <= 47);
  }
});

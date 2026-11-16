// La fila virtual es del día (lógica L1, ws6-t1): quien se anotó ayer y nadie
// sacó no cuenta como «esperando» hoy.
//   npx tsx --test src/lib/barber/__tests__/fila-del-dia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_sin-server-only";
import { isTodaysWalkIn, walkInDayStart } from "../fila-del-dia";
import { activeWalkInWhere, staleWalkInWhere } from "@/app/api/barber/walkins/_server";

const MX = "America/Mexico_City"; // UTC−6 todo el año
const MERIDA = "America/Merida";

test("la medianoche es la de la barbería, no la del servidor (UTC)", () => {
  // 15-nov 17:45 en México = 15-nov 23:45 UTC.
  const ahora = new Date("2026-11-15T23:45:00Z");
  assert.equal(walkInDayStart(MX, ahora).toISOString(), "2026-11-15T06:00:00.000Z");
  // 15-nov 20:30 en México = 16-nov 02:30 UTC: en UTC ya es mañana, en la barbería no.
  const noche = new Date("2026-11-16T02:30:00Z");
  assert.equal(walkInDayStart(MX, noche).toISOString(), "2026-11-15T06:00:00.000Z");
});

test("anotado ayer a las 10:31 p. m. ya no está en la fila de hoy", () => {
  const ahora = new Date("2026-11-15T23:45:00Z"); // 15-nov 5:45 p. m.
  const ayerNoche = new Date("2026-11-15T04:31:00Z"); // 14-nov 10:31 p. m. en México
  assert.equal(isTodaysWalkIn(ayerNoche, MX, ahora), false);
});

test("anotado hoy temprano, y justo a la medianoche, sí está", () => {
  const ahora = new Date("2026-11-15T23:45:00Z");
  assert.equal(isTodaysWalkIn(new Date("2026-11-15T15:10:00Z"), MX, ahora), true); // 9:10 a. m.
  assert.equal(isTodaysWalkIn(new Date("2026-11-15T06:00:00Z"), MX, ahora), true); // 00:00 en punto
  assert.equal(isTodaysWalkIn(new Date("2026-11-15T05:59:59Z"), MX, ahora), false); // 23:59:59 de ayer
});

test("otra zona: Mérida también es UTC−6; Tijuana corta a su medianoche", () => {
  const ahora = new Date("2026-11-15T23:45:00Z");
  assert.equal(walkInDayStart(MERIDA, ahora).toISOString(), "2026-11-15T06:00:00.000Z");
  assert.equal(walkInDayStart("America/Tijuana", ahora).toISOString(), "2026-11-15T08:00:00.000Z");
});

test("«De ayer · Sacarlos» toca justo lo que la fila de hoy deja fuera (y nada más)", () => {
  const ahora = new Date("2026-11-15T23:45:00Z");
  const hoy = activeWalkInWhere("shop1", MX, ahora);
  const ayer = staleWalkInWhere("shop1", MX, ahora);
  // Misma barbería y mismos estados (esperando / llamado): SERVED y LEFT nunca se tocan.
  assert.equal(ayer.barbershopId, "shop1");
  assert.deepEqual(ayer.status, hoy.status);
  assert.deepEqual([...ayer.status.in].sort(), ["CALLED", "WAITING"]);
  // El corte es la MISMA medianoche: gte para hoy, lt para lo de antes.
  assert.equal(hoy.joinedAt.gte.toISOString(), "2026-11-15T06:00:00.000Z");
  assert.equal(ayer.joinedAt.lt.toISOString(), "2026-11-15T06:00:00.000Z");
});

/**
 * «Cobro automático con tarjeta»: la sección de Configuración → Anticipos siempre dice si se puede encender y por qué
 * (revisión de Chrome, ws1-t9 #18: «no encontré el interruptor»).
 *
 * Run: npx tsx --test src/lib/cobro-automatico/__tests__/disponibilidad.test.ts
 *
 * Con el código viejo la sección devolvía `null` sin cuenta de Mercado Pago o sin el SQL: no había nada que ver.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { disponibilidadCobroAutomatico } from "../disponibilidad";

const estado = (o: Partial<{ conectado: boolean; tablas: boolean; encendido: boolean }> = {}) =>
  ({ plataforma: true, conectado: true, tablas: true, encendido: false, vivos: 0, ...o });

test("sin cuenta de Mercado Pago conectada: dice que falta conectar (no se calla)", () => {
  assert.equal(disponibilidadCobroAutomatico(false, undefined), "sin-cuenta");
  assert.equal(disponibilidadCobroAutomatico(true, estado({ conectado: false })), "sin-cuenta");
});

test("con cuenta pero sin el SQL de la función (o si la ruta falla): «todavía no disponible»", () => {
  assert.equal(disponibilidadCobroAutomatico(true, estado({ tablas: false })), "no-disponible");
  assert.equal(disponibilidadCobroAutomatico(true, null), "no-disponible");
});

test("consultando: no pinta nada hasta saber; con todo listo, el interruptor", () => {
  assert.equal(disponibilidadCobroAutomatico(true, undefined), "cargando");
  assert.equal(disponibilidadCobroAutomatico(true, estado()), "listo");
  assert.equal(disponibilidadCobroAutomatico(true, estado({ encendido: true })), "listo");
});

test("la sección ya no devuelve null por falta de cuenta, y Configuración enlaza a ella", () => {
  const sec = readFileSync(join(process.cwd(), "src/components/cobro-automatico/SeccionCobroAutomatico.tsx"), "utf8");
  assert.doesNotMatch(sec, /if \(!cuentaConectada \|\| !estado/);
  assert.match(sec, /t\.sinCuenta/);
  const cfg = readFileSync(join(process.cwd(), "src/app/dashboard/settings/settings-client.tsx"), "utf8");
  assert.match(cfg, /cobro automático con tarjeta de las mensualidades/);
});

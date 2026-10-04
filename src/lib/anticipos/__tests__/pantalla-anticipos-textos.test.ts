// ws1-t1 (ronda de arreglos de la auditoría de uso, C-102 y C-105) — Configuración › Anticipos.
// Con el código de antes: las plantillas salían con su clave interna («Link de anticipo (dc_anticipo_cita)»,
// «Recibo de pago (dc_recibo_pago)»), las fechas sin año («29-sep, 15:52») y la tabla «Últimos anticipos»
// tenía una sola columna «Ref. Mercado Pago», así que una transferencia con referencia salía «—».

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const PANTALLA = readFileSync(join(SRC, "app/dashboard/settings/anticipos/anticipos-client.tsx"), "utf8");
const LECTURA = readFileSync(join(SRC, "lib/anticipos/pantalla.server.ts"), "utf8");
const sinComentarios = (t: string) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("🔴→🟢 las plantillas se llaman como en Plantillas, sin claves internas", () => {
  const codigo = sinComentarios(PANTALLA);
  assert.ok(!/dc_anticipo_cita|dc_recibo_pago/.test(codigo));
  assert.match(codigo, /<Fila etiqueta="Solicitud de anticipo">/);
  assert.match(codigo, /<Fila etiqueta="Recibo de pago">/);
});

test("🔴→🟢 las fechas llevan año", () => {
  const f = PANTALLA.slice(PANTALLA.indexOf("function fecha("), PANTALLA.indexOf("export function AnticiposClient"));
  assert.match(f, /year: "numeric"/);
});

test("🔴→🟢 «Últimos anticipos» separa cómo pagó y la referencia (también la de la transferencia)", () => {
  const codigo = sinComentarios(PANTALLA);
  assert.ok(!codigo.includes("Ref. Mercado Pago"));
  assert.match(codigo, /<th>Cómo pagó<\/th>/);
  assert.match(codigo, /<th>Referencia<\/th>/);
  assert.match(codigo, /r\.referenciaMp \?\? r\.referenciaPago \?\? "—"/);
  // La lectura trae el método y la referencia del pago, con el tenant en los dos lados y sin tumbar la pantalla.
  const f = LECTURA.slice(LECTURA.indexOf("async function metodosYReferencias"), LECTURA.indexOf("export async function leerPantallaAnticipos"));
  assert.match(f, /where: \{ clinicId, id: \{ in: ids \} \}/);
  assert.match(f, /where: \{ id: \{ in: pagoIds \}, invoice: \{ clinicId \} \}/);
  assert.match(f, /catch \(e\)/);
});

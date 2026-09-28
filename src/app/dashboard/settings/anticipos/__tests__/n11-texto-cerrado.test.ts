// N11 (QA ronda 4, ws1-t2) — «Últimos anticipos» pintaba TODO estado EXPIRED
// como «Venció sin pago», pero ese status también lo pone
// `cerrarAnticiposDePanel` (panel.server.ts) cuando la factura se CANCELA o
// cambia de precio con el anticipo todavía PENDING — ahí nunca hubo un
// vencimiento por plazo, y el texto mentía. "Cerrado sin pago" es cierto en
// los dos casos.
//
// Prueba ESTÁTICA (lee el fuente): este repo no renderiza componentes de
// cliente en sus tests (tsx --test + node:test, sin RTL/jsdom).
// Run: npm run test:anticipos-n11-texto

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "anticipos-client.tsx"), "utf8");

test("N11: el estado EXPIRED ya no dice 'Venció sin pago' (falso cuando lo cerró la cancelación de la factura)", () => {
  assert.ok(!SRC.includes("Venció sin pago"), "todavía queda el texto viejo");
});

test("N11: el estado EXPIRED dice algo cierto en los dos casos (cron Y cancelación)", () => {
  const m = SRC.match(/EXPIRED:\s*\{\s*texto:\s*"([^"]+)"/);
  assert.ok(m, "no se encontró la entrada EXPIRED en el mapa de estados");
  assert.equal(m![1], "Cerrado sin pago");
});

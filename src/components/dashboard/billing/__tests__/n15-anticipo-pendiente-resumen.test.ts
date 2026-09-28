// N15 (QA ronda 4, ws1-t2) — el resumen del detalle de una factura con un
// anticipo PENDING no lo mencionaba: solo se enteraba quien abría «Cancelar»
// o «Registrar anticipo». El resumen (Total/Pagado/Saldo) ahora agrega una
// fila «Anticipo pendiente» cuando `anticipoPendiente` no es null.
//
// Prueba ESTÁTICA (lee el fuente): este repo no renderiza componentes de
// cliente en sus tests (tsx --test + node:test, sin RTL/jsdom).
// Run: npm run test:invoice-detail-n15

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "invoice-detail-modal.tsx"), "utf8");

test("N15: el resumen pinta una fila de 'Anticipo pendiente' cuando anticipoPendiente existe", () => {
  const idx = SRC.indexOf("{anticipoPendiente && (");
  assert.notEqual(idx, -1, "no se encontró el bloque condicional de anticipoPendiente en el resumen");
  const bloque = SRC.slice(idx, idx + 600);
  assert.match(bloque, /Anticipo pendiente/);
  assert.match(bloque, /fmtMXNdec\(anticipoPendiente\.amount\)/);
});

test("N15: el bloque de anticipoPendiente vive ANTES del Saldo (mismo resumen, no un modal aparte)", () => {
  const idxPendiente = SRC.indexOf("{anticipoPendiente && (");
  const idxSaldo = SRC.indexOf("clinical.invoiceDetail.balance");
  assert.ok(idxPendiente > -1 && idxSaldo > -1 && idxPendiente < idxSaldo);
});

// H16 (revisión final, ws1-t4): «Registrar anticipo recibido» nunca prellena el saldo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { montoInicialAnticipoRecibido } from "../registrar-prellenado";

test("sin anticipo pendiente (o sin cargar): el campo sale VACÍO, nunca el saldo", () => {
  assert.equal(montoInicialAnticipoRecibido(null, 600), "");
  assert.equal(montoInicialAnticipoRecibido(undefined, 600), "");
  assert.equal(montoInicialAnticipoRecibido({ amount: 0 }, 600), "");
});

test("con pendiente: su monto, sin pasar del saldo", () => {
  assert.equal(montoInicialAnticipoRecibido({ amount: 100 }, 600), "100");
  assert.equal(montoInicialAnticipoRecibido({ amount: 300 }, 150), "150");
  assert.equal(montoInicialAnticipoRecibido({ amount: 99.999 }, 600), "100");
});

test("cableado: el modal usa la regla y el detalle limpia lo de la factura anterior al recargar", () => {
  const raiz = join(__dirname, "../../../..");
  const modal = readFileSync(join(raiz, "src/components/dashboard/billing/modal-registrar-anticipo.tsx"), "utf8");
  assert.match(modal, /const prefill = \(\) => montoInicialAnticipoRecibido\(anticipoPendiente, saldo\);/);
  assert.doesNotMatch(modal, /String\(saldo\)/);
  const detalle = readFileSync(join(raiz, "src/components/dashboard/billing/invoice-detail-modal.tsx"), "utf8");
  assert.match(detalle, /let vivo = true;\s*\/\/ H16[\s\S]{0,400}setAnticipoPendiente\(null\); setPuedeDepositar\(false\); setPuedeRegistrarAnticipo\(false\);/);
});

// H7 (revisión final, ws1-t4): anular un anticipo registrado por error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ESTADO_MP_ANULADO,
  facturaTrasAnular,
  notaDeAnulacion,
  pagoSumoALaFactura,
  validarMotivoAnulacion,
} from "../anular-core";

const RAIZ = join(__dirname, "../../../..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");

test("el motivo es obligatorio (mínimo 5 letras, máximo 300)", () => {
  assert.match(validarMotivoAnulacion("") ?? "", /por qué/);
  assert.match(validarMotivoAnulacion("   ab  ") ?? "", /por qué/);
  assert.match(validarMotivoAnulacion(undefined) ?? "", /por qué/);
  assert.equal(validarMotivoAnulacion("Se registró dos veces"), null);
  assert.match(validarMotivoAnulacion("x".repeat(301)) ?? "", /largo/);
});

test("la factura vuelve a como estaba", () => {
  // PARCIAL por un anticipo de $200 sobre $800 → PENDIENTE sin nada pagado.
  assert.deepEqual(facturaTrasAnular(800, 200, 200), { paid: 0, balance: 800, status: "PENDING" });
  // $400 de antes + $200 de anticipo → PARCIAL con $400.
  assert.deepEqual(facturaTrasAnular(1200, 600, 200), { paid: 400, balance: 800, status: "PARTIAL" });
  // El caso de la revisión: $600 de más la dejaron PAGADA → vuelve a PARCIAL.
  assert.deepEqual(facturaTrasAnular(800, 800, 600), { paid: 200, balance: 600, status: "PARTIAL" });
  // Nunca negativo.
  assert.deepEqual(facturaTrasAnular(800, 100, 200), { paid: 0, balance: 800, status: "PENDING" });
});

test("el pago de MP sobre una factura cancelada o saldada no sumó: anularlo no resta", () => {
  assert.equal(pagoSumoALaFactura("Anticipo, pagado con Mercado Pago. ⚠️ Anticipo pagado sobre factura cancelada: revisar/devolver"), false);
  assert.equal(pagoSumoALaFactura("⚠️ Anticipo pagado sobre factura ya saldada: revisar/devolver"), false);
  assert.equal(pagoSumoALaFactura("Anticipo, pagado con Mercado Pago desde el panel (pago 123)."), true);
  assert.equal(pagoSumoALaFactura(null), true);
});

test("la nota dice cuánto era, con qué, quién, cuándo y por qué", () => {
  const nota = notaDeAnulacion({ monto: 600, method: "cash", quien: "Ana Pérez", cuando: new Date("2026-09-29T15:04:00Z"), motivo: " era $100, no $600 " });
  assert.match(nota, /ANTICIPO ANULADO el 2026-09-29 15:04 UTC por Ana Pérez: era \$100, no \$600\./);
  assert.match(nota, /Era \$600(\.00)? en efectivo\./);
});

test("servidor: una transacción con candado, sin borrar, pago a $0, anticipo anulado, y lo que bloquea", () => {
  const src = leer("src/lib/anticipos/anular.server.ts");
  assert.match(src, /SELECT id FROM invoices WHERE id = \$\{invoiceId\} FOR UPDATE/);
  assert.match(src, /data: \{ amount: 0, notes:/);
  assert.match(src, /status: "FAILED", lastMpStatus: ESTADO_MP_ANULADO/);
  assert.equal(ESTADO_MP_ANULADO, "anulado");
  assert.match(src, /if \(inv\.status === "CANCELLED"\)/);
  assert.match(src, /if \(inv\.cfdiUuid\)/, "timbrada: no se anula");
  assert.match(src, /algunPagoTieneCfdiVigente\(tx/);
  assert.match(src, /where: \{ id: depositId, clinicId, invoiceId, status: "PAID" \}/);
  assert.doesNotMatch(src, /\.delete\(|deleteMany/);
});

test("ruta: solo con permiso de cobro, clínica de la sesión, visibilidad y bitácora; avisa lo de MP", () => {
  const ruta = leer("src/app/api/invoices/[id]/anticipo/anular/route.ts");
  assert.equal((ruta.match(/denyIfMissingPermission\(ctx, "billing\.charge"\)/g) ?? []).length, 2, "GET y POST");
  assert.match(ruta, /assertPatientVisible\(/);
  assert.match(ruta, /clinicId: ctx\.clinicId, invoiceId: params\.id, depositId, userId: ctx\.userId/);
  assert.match(ruta, /logMutation\(/);
  assert.match(ruta, /el reembolso al paciente se hace en tu cuenta de Mercado Pago/);
});

test("el detalle de la factura monta «Anular anticipo»", () => {
  assert.match(leer("src/components/dashboard/billing/invoice-detail-modal.tsx"), /<AnularAnticipo\s/);
});

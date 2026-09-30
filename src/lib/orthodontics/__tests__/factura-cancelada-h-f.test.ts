// ws1-t10 — F «Factura cancelada»: «Ortodoncia sigue contando sus cuotas
// como deuda y el caso no puede abrir otro plan».
//
// Candado de CABLEADO (mismo patrón que otros `leer código fuente` de esta
// casa): una factura CANCELLED no debe seguir contando como deuda en los tres
// sitios que la leen para calcular cobranza, y el caso debe poder abrir un
// plan nuevo cuando la que tenía ligada está cancelada.
//
// Correr: npm run test:factura-cancelada-h-f

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("cobranza-db.ts: una factura CANCELLED no cuenta como deuda del caso", () => {
  const src = leer("lib/orthodontics/cobranza-db.ts");
  assert.match(src, /select: \{ status: true, total: true, (dueDate: true, createdAt: true, )?payments:/, "lee el status de la factura, no solo total/pagos");
  assert.match(src, /const facturaVigente = invoice && invoice\.status !== "CANCELLED" \? invoice : null;/);
  assert.match(src, /facturaPrincipal: facturaVigente\s*\n\s*\? \{\s*condiciones: condicionesResult\.porFactura\.get\(invoiceId!\) \?\? null,\s*totalFactura: facturaVigente\.total,\s*cobros: facturaVigente\.payments,[\s\S]*?\}\s*\n\s*: null,/);
});

test("cargarPanelDeCobro.ts: el panel de cobro tampoco cuenta una factura CANCELLED como deuda", () => {
  const src = leer("app/actions/orthodontics/cobro/cargarPanelDeCobro.ts");
  assert.match(src, /const facturaVigente = invoice && invoice\.status !== "CANCELLED" \? invoice : null;/);
  assert.match(src, /facturaPrincipal: facturaVigente\s*\? \{\s*condiciones,\s*totalFactura: facturaVigente\.total,\s*cobros: facturaVigente\.payments,[\s\S]*?\}\s*: null,/);
});

test("ResumenCobranza.tsx: el botón «Cobrar» no se ofrece sobre una factura cancelada", () => {
  const src = leer("components/specialties/orthodontics/cobranza/ResumenCobranza.tsx");
  // ws1-t4: y además solo con permiso de cobro. Revisión final: la factura sale de
  // `cobroPrincipalDelCaso` y nunca es la principal si está cancelada.
  assert.match(src, /panel\.invoice\?\.status === "CANCELLED"/);
  assert.match(src, /\{panel\.puedeCobrar && puedeOfrecerCobro \? \(/);
});

test("abrirPlanDePago.ts: una factura cancelada NO bloquea abrir el plan de verdad", () => {
  const src = leer("app/actions/orthodontics/cobro/abrirPlanDePago.ts");
  assert.match(src, /if \(anterior\?\.status !== "CANCELLED"\) return fail\("Este caso ya tiene un plan de pago abierto"\);/);
  assert.match(src, /invoiceAnteriorCancelada = true;/);
  assert.match(src, /invoiceId: invoiceAnteriorCancelada \? caso\.invoiceId : null,/, "el reemplazo defensivo solo acepta la MISMA cancelada de antes, o ninguna");
});

test("abrirPlanDePago.ts: una factura VIGENTE (no cancelada) sigue bloqueando — un plan a la vez", () => {
  const src = leer("app/actions/orthodontics/cobro/abrirPlanDePago.ts");
  const i = src.indexOf("if (caso.invoiceId) {");
  const cierre = src.indexOf("invoiceAnteriorCancelada = true;");
  assert.ok(i > 0 && cierre > i, "el chequeo de la factura anterior sigue leyendo su status ANTES de decidir");
});

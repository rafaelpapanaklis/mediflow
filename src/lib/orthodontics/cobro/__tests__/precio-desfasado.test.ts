// ws1-t10, F «Cambio de técnica o de precio» — el caso y su factura no se desfasan en silencio.
// Correr: npm run test:orto-precio-desfasado
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoDePrecioDesfasado } from "../precio-desfasado";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("mismo precio (o centavos de ruido): sin aviso", () => {
  assert.equal(avisoDePrecioDesfasado({ totalFactura: 24000, precioDelCaso: 24000, cambioTecnica: false }), undefined);
  assert.equal(avisoDePrecioDesfasado({ totalFactura: 24000, precioDelCaso: 24000.3, cambioTecnica: true }), undefined);
});
test("el caso subió: faltan X — cobrarlos como extra o subir la factura", () => {
  const a = avisoDePrecioDesfasado({ totalFactura: 24000, precioDelCaso: 30000, cambioTecnica: true })!;
  assert.match(a, /cambio de técnica/);
  assert.match(a, /Faltan \$6,000/);
  assert.match(a, /Cobrar extra/);
});
test("el caso bajó: sobran X en la factura", () => {
  const a = avisoDePrecioDesfasado({ totalFactura: 30000, precioDelCaso: 24000, cambioTecnica: false })!;
  assert.match(a, /cambio de precio/);
  assert.match(a, /Sobran \$6,000/);
});
test("guardar el caso compara con la factura de la clínica de la sesión y el tab lo muestra", () => {
  const u = leer("app/actions/orthodontics/updateTreatmentPlan.ts");
  assert.match(u, /where: \{ id: facturaDelCaso, clinicId: ctx\.clinicId \}/);
  assert.match(u, /inv\.status !== "CANCELLED"/);
  assert.match(leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /res\.data\.avisoPrecioDesfasado/);
});

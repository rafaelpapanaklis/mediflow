// ws1-t4 #73 — el saldo de la cabecera solo es rojo si algo VENCIÓ.
// Correr: npm run test:orto-saldo-cabecera
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { subDelSaldo } from "../saldo-cabecera";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("sin factura: «Sin plan de pago»", () => assert.equal(subDelSaldo(null, null), "Sin plan de pago"));
test("con vencido: dice cuánto", () => assert.match(subDelSaldo(23000, 2000), /^Vencido \$2,000/));
test("debe pero nada venció: «Al corriente», no «Pendiente»", () => assert.equal(subDelSaldo(23000, 0), "Al corriente"));
test("sin saldo: «Al día»", () => assert.equal(subDelSaldo(0, 0), "Al día"));

test("la cabecera solo pinta rojo con lo vencido y el cliente lo saca de las cuotas vencidas del panel", () => {
  const h = leer("components/specialties/orthodontics/redesign/PatientHeaderG16.tsx");
  assert.match(h, /tone=\{props\.outstandingAmount != null && \(props\.overdueAmount \?\? 0\) > 0 \? "rose" : "emerald"\}/);
  const c = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  // ws1-t4 (revisión final, fallo 1): lo vencido de `deudaDelCaso` (sale de las mismas cuotas vencidas).
  assert.match(c, /panelDeCobro\.deuda\.vencido/);
  assert.match(c, /overdueAmount=\{overdueAmountReal\}/);
});

// ws1-t4 — saldo a favor en Ortodoncia: la cabecera lo dice junto al saldo, con la cifra del panel (la del resumen del paciente).
test("con saldo a favor: se añade «· a favor $X» a cualquier estado", () => {
  assert.equal(subDelSaldo(23000, 0, 1500), "Al corriente · a favor $1,500");
  assert.match(subDelSaldo(23000, 2000, 1500), /^Vencido \$2,000.* · a favor \$1,500$/);
  assert.equal(subDelSaldo(null, null, 300), "Sin plan de pago · a favor $300");
  assert.equal(subDelSaldo(0, 0, 0), "Al día", "sin saldo a favor, como siempre");
  const c = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(c, /creditAmount=\{panelDeCobro && panelDeCobro !== "cargando" && panelDeCobro !== "error" \? panelDeCobro\.saldoAFavor : null\}/);
});

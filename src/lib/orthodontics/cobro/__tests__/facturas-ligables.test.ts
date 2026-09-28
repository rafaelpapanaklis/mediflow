// ws1-t4 #75 — «Abrir plan de pago» solo sabía crear OTRA factura: quedaban
// dos del mismo tratamiento. Ahora también se liga una que ya existe.
//
// Correr: npm run test:facturas-ligables
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { conceptoDeFactura, esFacturaLigable } from "../facturas-ligables";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("se puede ligar una factura pendiente, parcial, pagada o vencida, sin cita y sin caso", () => {
  for (const status of ["PENDING", "PARTIAL", "PAID", "OVERDUE"]) {
    assert.equal(esFacturaLigable({ status, appointmentId: null, ligadaACaso: null }), true, status);
  }
});

test("no se liga un borrador ni una cancelada", () => {
  assert.equal(esFacturaLigable({ status: "DRAFT", appointmentId: null, ligadaACaso: null }), false);
  assert.equal(esFacturaLigable({ status: "CANCELLED", appointmentId: null, ligadaACaso: null }), false);
});

test("no se liga la factura de una cita ni la que ya es el plan de un caso", () => {
  assert.equal(esFacturaLigable({ status: "PENDING", appointmentId: "cita-1", ligadaACaso: null }), false);
  assert.equal(esFacturaLigable({ status: "PENDING", appointmentId: null, ligadaACaso: "caso-1" }), false);
});

test("el concepto se lee del primer renglón y avisa de los demás", () => {
  assert.equal(conceptoDeFactura([{ name: "Tratamiento de ortodoncia" }]), "Tratamiento de ortodoncia");
  assert.equal(conceptoDeFactura([{ name: "Tratamiento" }, { name: "Retenedores" }]), "Tratamiento (+1)");
  assert.equal(conceptoDeFactura([]), "Sin conceptos");
  assert.equal(conceptoDeFactura(null), "Sin conceptos");
});

test("el servidor no liga una cancelada ni la factura de otro caso, y la lista sale con el clinicId de la sesión", () => {
  const abrir = leer("app/actions/orthodontics/cobro/abrirPlanDePago.ts");
  assert.match(abrir, /invoice\.status === "CANCELLED"\) return fail/);
  assert.match(abrir, /ya es el plan de pago de otro caso/);
  const lista = leer("app/actions/orthodontics/cobro/listarFacturasLigables.ts");
  assert.match(lista, /clinicId: ctx\.clinicId,\s*patientId: caso\.patientId/);
  assert.match(lista, /if \(!ctx\.clinicId\) return fail/);
});

test("la sección de finanzas ofrece «ligarla al caso» junto a abrir el plan", () => {
  const src = leer("components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.match(src, /Ya tengo la factura: ligarla al caso/);
  assert.match(src, /<DrawerLigarFactura/);
});

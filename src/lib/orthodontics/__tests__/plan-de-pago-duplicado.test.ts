/**
 * X4 — «Abrir plan de pago» con dos pestañas: la segunda recibe la factura
 * que ya quedó ligada y su copia se cancela solo si es inocua.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/plan-de-pago-duplicado.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VENTANA_DUPLICADA_MS,
  avisoDePlanYaAbierto,
  decidirFacturaDuplicada,
  type FacturaCandidataADuplicada,
} from "../cobro/plan-de-pago-duplicado";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const ahora = new Date("2026-09-28T12:00:00Z");
const base: FacturaCandidataADuplicada = {
  patientId: "p1",
  status: "PENDING",
  paid: 0,
  cfdiUuid: null,
  appointmentId: null,
  createdAt: new Date(ahora.getTime() - 60_000),
  ligadaACaso: null,
};
const decide = (f: Partial<FacturaCandidataADuplicada> | null) =>
  decidirFacturaDuplicada({ duplicada: f === null ? null : { ...base, ...f }, patientIdDelCaso: "p1", ahora });

test("la copia recién creada, sin pagos, sin CFDI ni cita, se cancela", () => {
  assert.deepEqual(decide({}), { cancelar: true, motivo: null });
});

test("cualquier señal de que la factura importa la deja intacta", () => {
  assert.equal(decide(null).cancelar, false);
  assert.equal(decide({ patientId: "otro" }).cancelar, false);
  assert.equal(decide({ status: "PARTIAL" }).cancelar, false);
  assert.equal(decide({ paid: 100 }).cancelar, false, "saldo a favor aplicado al crearla");
  assert.equal(decide({ cfdiUuid: "uuid" }).cancelar, false);
  assert.equal(decide({ appointmentId: "cita" }).cancelar, false);
  assert.equal(decide({ ligadaACaso: "otro-caso" }).cancelar, false);
  assert.equal(decide({ createdAt: new Date(ahora.getTime() - VENTANA_DUPLICADA_MS - 1) }).cancelar, false);
  assert.equal(decide({ createdAt: new Date(ahora.getTime() + 60_000) }).cancelar, false);
});

test("el aviso dice qué pasó con la copia", () => {
  assert.match(avisoDePlanYaAbierto({ numeroVigente: "F-1", numeroDuplicada: "F-2", duplicadaCancelada: true }), /\(F-1\).*\(F-2\) se canceló/);
  assert.match(avisoDePlanYaAbierto({ numeroVigente: null, numeroDuplicada: "F-2", duplicadaCancelada: false }), /NO quedó ligada.*cancélala desde Facturación/);
});

test("abrirPlanDePago: idempotente con la misma factura y la segunda pestaña recibe la vigente", () => {
  const src = leer("app/actions/orthodontics/cobro/abrirPlanDePago.ts");
  assert.match(src, /caso\.invoiceId === args\.invoiceId\) \{\s*return ok\(\{ invoiceId: args\.invoiceId \}\);/);
  assert.equal((src.match(/return quedarseConLaVigente\(/g) ?? []).length, 2, "antes de ligar y al perder la carrera");
  assert.match(src, /if \(ahora\?\.invoiceId === args\.invoiceId\) return ok\(\{ invoiceId: args\.invoiceId \}\);/);
  // La cancelación de la copia repite las condiciones en la escritura (si entró un pago, no cancela).
  assert.match(src, /where: \{ id: duplicadaId, clinicId, status: "PENDING", paid: \{ lte: 0 \}, cfdiUuid: null, appointmentId: null \}/);
  assert.match(src, /await cerrarLinksDeFactura\(\{ clinicId, invoiceId: duplicadaId \}\);/);
});

test("SectionFinance pregunta antes de crear y muestra el aviso de la segunda pestaña", () => {
  const src = leer("components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.match(src, /antesDeCrear=\{async \(\) => \{\s*const r = await comprobarPlanDePagoLibre\(/);
  assert.match(src, /else if \(r\.data\.aviso\) \{ window\.alert\(r\.data\.aviso\); \}/);
  const modal = leer("components/billing/invoice-editor-modal.tsx");
  const i = modal.indexOf("const motivo = await antesDeCrear()");
  const post = modal.indexOf('const res = await fetch("/api/invoices"');
  assert.ok(i > 0 && post > i, "la comprobación va ANTES del POST que crea la factura");
});

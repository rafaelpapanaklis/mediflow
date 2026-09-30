// ws1-t10 — hoja de control: mes real, fase como clave, secuencia de arcos al firmar, plantillas por técnica y «Control X de N».
// Correr: npx tsx --test src/lib/orthodontics/__tests__/hoja-de-control-t10.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesDeTratamiento, textoDelMes } from "../mes-de-tratamiento";
import { claveDeFase } from "../fase-de-hoja";
import { cambiosAlFirmarConArco, type PasoDeArco } from "../secuencia-de-arcos";
import { plantillaAplicaALaTecnica } from "../plantillas-por-tecnica";
import { numeroDeEsteControl } from "../controles-hechos";
import { progresoDeControles, textoControlQueSigue } from "../plan-detalle";
import { ORTHO_DEFAULT_TEMPLATES } from "@/lib/clinical-shared/evolution-templates/seed-orthodontics";

test("mes: meses reales con un decimal desde la colocación", () => {
  const colocacion = new Date("2026-06-01T15:00:00Z");
  assert.equal(mesDeTratamiento(colocacion, new Date("2026-06-01T18:00:00Z")), 0);
  assert.equal(mesDeTratamiento(colocacion, new Date("2026-07-16T15:00:00Z")), 1.5);
  assert.equal(mesDeTratamiento(colocacion, new Date("2026-09-29T15:00:00Z")), 3.9);
});

test("mes: sin colocación, o una visita anterior a ella, es 0 (nunca negativo ni NaN)", () => {
  assert.equal(mesDeTratamiento(null, new Date()), 0);
  assert.equal(mesDeTratamiento(new Date("2026-10-01"), new Date("2026-09-01")), 0);
  assert.equal(mesDeTratamiento(new Date("nada"), new Date()), 0);
});

test("textoDelMes: sin el «.0» de relleno", () => {
  assert.equal(textoDelMes(0), "mes 0");
  assert.equal(textoDelMes(3), "mes 3");
  assert.equal(textoDelMes(3.5), "mes 3.5");
  assert.equal(textoDelMes(Number.NaN), "mes 0");
});

test("fase: la clave sale igual venga como clave o como nombre", () => {
  assert.equal(claveDeFase("ALIGNMENT"), "ALIGNMENT");
  assert.equal(claveDeFase("Alineación"), "ALIGNMENT");
  assert.equal(claveDeFase("Nivelación"), "LEVELING");
  assert.equal(claveDeFase("Sin fase"), null);
  assert.equal(claveDeFase(null), null);
  assert.equal(claveDeFase(undefined), null);
});

const paso = (id: string, status: PasoDeArco["status"], applied: string | null = null, completed: string | null = null): PasoDeArco => ({
  id,
  status,
  appliedDate: applied ? new Date(applied) : null,
  completedDate: completed ? new Date(completed) : null,
});
const visita = new Date("2026-09-29T16:00:00Z");

test("secuencia: el arco usado pasa a actual con inicio y el que estaba en uso se cierra", () => {
  const cambios = cambiosAlFirmarConArco({
    pasos: [paso("a", "ACTIVE", "2026-08-01T16:00:00Z"), paso("b", "PLANNED"), paso("c", "PLANNED")],
    arcoNuevoId: "b",
    arcoAnteriorId: "a",
    fecha: visita,
  });
  assert.deepEqual(cambios, [
    { id: "b", status: "ACTIVE", appliedDate: visita, completedDate: null },
    { id: "a", status: "COMPLETED", appliedDate: new Date("2026-08-01T16:00:00Z"), completedDate: visita },
  ]);
});

test("secuencia: el arco de llegada que nunca se marcó también se cierra (caso recién abierto)", () => {
  const cambios = cambiosAlFirmarConArco({ pasos: [paso("a", "PLANNED"), paso("b", "PLANNED")], arcoNuevoId: "b", arcoAnteriorId: "a", fecha: visita });
  assert.deepEqual(
    cambios.map((c) => [c.id, c.status]),
    [["b", "ACTIVE"], ["a", "COMPLETED"]],
  );
});

test("secuencia: sin cambio de arco no se mueve nada, ni con un arco ajeno al caso", () => {
  const pasos = [paso("a", "ACTIVE", "2026-08-01T16:00:00Z"), paso("b", "PLANNED")];
  assert.deepEqual(cambiosAlFirmarConArco({ pasos, arcoNuevoId: null, fecha: visita }), []);
  assert.deepEqual(cambiosAlFirmarConArco({ pasos, arcoNuevoId: "z", fecha: visita }), []);
});

test("secuencia: el mismo arco que ya estaba en uso conserva su inicio (no cambia nada)", () => {
  const pasos = [paso("a", "ACTIVE", "2026-08-01T16:00:00Z"), paso("b", "PLANNED")];
  assert.deepEqual(cambiosAlFirmarConArco({ pasos, arcoNuevoId: "a", arcoAnteriorId: "a", fecha: visita }), []);
});

test("secuencia: un arco activo sin inicio lo recibe; volver a un arco ya cerrado lo reabre sin fin", () => {
  assert.deepEqual(cambiosAlFirmarConArco({ pasos: [paso("a", "ACTIVE")], arcoNuevoId: "a", fecha: visita }), [
    { id: "a", status: "ACTIVE", appliedDate: visita, completedDate: null },
  ]);
  const vuelta = cambiosAlFirmarConArco({
    pasos: [paso("a", "COMPLETED", "2026-07-01T16:00:00Z", "2026-08-01T16:00:00Z"), paso("b", "ACTIVE", "2026-08-01T16:00:00Z")],
    arcoNuevoId: "a",
    arcoAnteriorId: "b",
    fecha: visita,
  });
  assert.deepEqual(
    vuelta.map((c) => [c.id, c.status, c.completedDate?.toISOString() ?? null]),
    [["a", "ACTIVE", null], ["b", "COMPLETED", visita.toISOString()]],
  );
});

test("secuencia: un paso ya cerrado o saltado que no es el nuevo no se toca", () => {
  const cambios = cambiosAlFirmarConArco({
    pasos: [paso("x", "COMPLETED", "2026-06-01T16:00:00Z", "2026-07-01T16:00:00Z"), paso("s", "SKIPPED"), paso("b", "PLANNED")],
    arcoNuevoId: "b",
    fecha: visita,
  });
  assert.deepEqual(cambios.map((c) => c.id), ["b"]);
});

test("plantillas: en brackets no sale «Cambio de alineador»; en alineadores no salen las de aparatología fija", () => {
  const nombres = (tecnica: string | null) => ORTHO_DEFAULT_TEMPLATES.filter((t) => plantillaAplicaALaTecnica({ name: t.name, proceduresPrefilled: t.procedures }, tecnica)).map((t) => t.name);
  assert.deepEqual(nombres("METAL_BRACKETS"), ["Cementado de brackets", "Activación de arco", "Control mensual general", "Retiro de brackets", "Entrega de retenedor"]);
  assert.deepEqual(nombres("SELF_LIGATING_CERAMIC"), nombres("METAL_BRACKETS"));
  assert.deepEqual(nombres("CLEAR_ALIGNERS"), ["Control mensual general", "Cambio de alineador", "Entrega de retenedor"]);
  assert.equal(nombres("HYBRID").length, ORTHO_DEFAULT_TEMPLATES.length);
  assert.equal(nombres(null).length, ORTHO_DEFAULT_TEMPLATES.length);
});

test("plantillas: una propia de la clínica se ofrece siempre; sin procedimientos se decide por el nombre", () => {
  assert.equal(plantillaAplicaALaTecnica({ name: "Mi nota de control", proceduresPrefilled: [] }, "CLEAR_ALIGNERS"), true);
  assert.equal(plantillaAplicaALaTecnica({ name: "Mi nota de control" }, "METAL_BRACKETS"), true);
  assert.equal(plantillaAplicaALaTecnica({ name: "Cambio de alineador" }, "METAL_BRACKETS"), false);
  assert.equal(plantillaAplicaALaTecnica({ name: "  Retiro de Brackets " }, "CLEAR_ALIGNERS"), false);
});

test("«Control X de N»: la visita que ya cuenta lleva su número; la nueva, el que sigue", () => {
  assert.equal(numeroDeEsteControl({ hechos: 0, yaCuenta: false }), 1);
  assert.equal(numeroDeEsteControl({ hechos: 1, yaCuenta: false }), 2);
  assert.equal(numeroDeEsteControl({ hechos: 3, yaCuenta: true }), 3);
  assert.equal(numeroDeEsteControl({ hechos: 0, yaCuenta: true }), 1);
  assert.equal(textoControlQueSigue(progresoDeControles(numeroDeEsteControl({ hechos: 1, yaCuenta: false }) - 1, 18)), "Control 2 de 18");
});

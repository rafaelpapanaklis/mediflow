/**
 * ws1-t8 — F11 y mejora 8 de la auditoría de BEVADENT: los 45 casos migrados de Dentalink salían TODOS en «Casos con
 * diagnóstico o plan incompleto» («Falta: diagnóstico (valores de migración) · controles previstos · factura de
 * colocación») y solo se podían completar uno por uno.
 *  · F11: a un caso migrado YA colocado en «Pago por control» no se le pide «factura de colocación».
 *  · M8: marca «migrado, sin datos de diagnóstico» (saca el diagnóstico de la alerta sin inventar nada) y una tabla
 *    para completar doctor, tiempo y controles previstos de varios casos a la vez.
 *
 * Run: npm run test:orto-casos-alertas
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  esPlanDetalleVacio,
  normalizarPlanDetalle,
  pasoQueFalta,
  piezasQueFaltan,
  planDetalleVacio,
  tieneMarcasDelPlan,
  type PlanDetalle,
} from "../plan-detalle";
import {
  esCasoMigrado,
  estaColocado,
  motivoParaNoAplicar,
  propuestaDeControles,
  validarCambiosEnBloque,
} from "../completar-casos";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const plan = (extra: Partial<PlanDetalle> = {}): PlanDetalle => ({ ...planDetalleVacio(), ...extra });

/** Un caso migrado de Dentalink tal como lo deja el importador: colocado, en «Pago por control», sin factura. */
const MIGRADO = {
  diagnosticoMigrado: true,
  sinCapturar: [] as string[],
  doctorId: "doc-1",
  detalle: plan(),
  billingMode: "PAGO_POR_CONTROL" as const,
  tieneFactura: false,
  casoMigrado: true,
  colocado: true,
};
const claves = (p: ReturnType<typeof piezasQueFaltan>) => p.map((x) => x.clave);

test("F11 · migrado y colocado en «Pago por control»: ya no pide «factura de colocación»", () => {
  assert.deepEqual(claves(piezasQueFaltan(MIGRADO)), ["diagnostico-migrado", "controles"]);
  // Con el código de antes salía siempre:
  assert.ok(!piezasQueFaltan(MIGRADO).some((p) => p.texto === "factura de colocación"));
});

test("F11 · la factura de colocación se sigue pidiendo donde sí falta", () => {
  // Migrado pero aún por colocar: la colocación se cobra aquí.
  assert.ok(claves(piezasQueFaltan({ ...MIGRADO, colocado: false })).includes("cobro"));
  // Abierto aquí (no migrado) y colocado sin factura: falta de verdad.
  assert.ok(claves(piezasQueFaltan({ ...MIGRADO, diagnosticoMigrado: false, casoMigrado: false })).includes("cobro"));
  // «Precio total»: el plan de pago no es la colocación; se sigue pidiendo.
  const total = piezasQueFaltan({ ...MIGRADO, billingMode: "PRECIO_TOTAL" });
  assert.ok(total.some((p) => p.clave === "cobro" && p.texto === "plan de pago"));
  // Sin los datos nuevos (quien llama como antes) se comporta como antes.
  const { casoMigrado: _a, colocado: _b, ...comoAntes } = MIGRADO;
  void _a;
  void _b;
  assert.ok(claves(piezasQueFaltan(comoAntes)).includes("cobro"));
});

test("M8 · la marca saca el diagnóstico de la alerta y deja lo demás", () => {
  const marcado = piezasQueFaltan({ ...MIGRADO, detalle: plan({ migradoSinDiagnostico: true }) });
  assert.deepEqual(claves(marcado), ["controles"]);
  assert.equal(pasoQueFalta(marcado), "plan");
  // Con controles previstos ya no falta nada: sale de la alerta.
  assert.deepEqual(piezasQueFaltan({ ...MIGRADO, detalle: plan({ migradoSinDiagnostico: true, controlesPrevistos: 18 }) }), []);
  // La marca también tapa los «sin capturar» de un diagnóstico migrado que ya se editó a medias.
  const aMedias = piezasQueFaltan({
    ...MIGRADO,
    diagnosticoMigrado: false,
    sinCapturar: ["angleClassRight", "overjetMm"],
    detalle: plan({ migradoSinDiagnostico: true, controlesPrevistos: 18 }),
  });
  assert.deepEqual(aMedias, []);
});

test("M8 · la marca se guarda en el plan sin contar como dato (y un plan con solo la marca sí se guarda)", () => {
  const leido = normalizarPlanDetalle({ migradoSinDiagnostico: true });
  assert.equal(leido.migradoSinDiagnostico, true);
  assert.equal(normalizarPlanDetalle({ migradoSinDiagnostico: "sí" }).migradoSinDiagnostico, undefined);
  assert.equal(esPlanDetalleVacio(leido), true, "no es un dato del plan");
  assert.equal(tieneMarcasDelPlan(leido), true, "pero se guarda (no se vuelve NULL)");
});

test("caso migrado: cualquiera de las huellas del importador, aunque el diagnóstico ya se haya editado", () => {
  assert.equal(esCasoMigrado({ etiologyNotes: "Migrado de Dentalink — sin datos clínicos" }), true);
  // Al editar el diagnóstico la marca de etiologyNotes se borra; quedan el resumen o el plan de retención.
  assert.equal(esCasoMigrado({ etiologyNotes: "", clinicalSummary: "Caso migrado de Dentalink (# Tratamiento 12) sin diagnóstico…" }), true);
  assert.equal(
    esCasoMigrado({ retentionPlanText: "Plan de retención sin registrar (caso migrado de Dentalink): se define al llegar a la etapa de retención." }),
    true,
  );
  assert.equal(esCasoMigrado({ migradoSinDiagnostico: true }), true);
  assert.equal(esCasoMigrado({ etiologyNotes: "Hábito de succión digital", clinicalSummary: "Clase II div 1", retentionPlanText: "Hawley superior" }), false);
  assert.equal(esCasoMigrado({}), false);
});

test("colocado: fecha de colocación o un estado que ya no es «Por colocar»", () => {
  assert.equal(estaColocado({ installedAt: new Date(), status: "PLANNED" }), true);
  assert.equal(estaColocado({ installedAt: null, status: "IN_PROGRESS" }), true);
  assert.equal(estaColocado({ installedAt: null, status: "PLANNED" }), false);
});

test("controles previstos propuestos: la duración real entre la frecuencia de la clínica; sin duración, nada", () => {
  assert.equal(propuestaDeControles(18, 30), 18);
  assert.equal(propuestaDeControles(24, 42), 17);
  assert.equal(propuestaDeControles(null, 30), null);
});

test("validar lo que manda la tabla: estricto, sin repetidos, descarta filas sin cambios", () => {
  const r = validarCambiosEnBloque([
    { planId: "a1", controlesPrevistos: "18", duracionMeses: 24 },
    { planId: "b2", migradoSinDiagnostico: true },
    { planId: "c3" },
    { planId: "d4", doctorId: "" },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.cambios, [
    { planId: "a1", controlesPrevistos: 18, duracionMeses: 24 },
    { planId: "b2", migradoSinDiagnostico: true },
  ]);
  assert.equal(validarCambiosEnBloque([{ planId: "a1", controlesPrevistos: 0 }]).ok, false);
  assert.equal(validarCambiosEnBloque([{ planId: "a1", controlesPrevistos: 2.5 }]).ok, false);
  assert.equal(validarCambiosEnBloque([{ planId: "a1", duracionMeses: 500 }]).ok, false);
  assert.equal(validarCambiosEnBloque([{ planId: "a1", controlesPrevistos: 3 }, { planId: "a1", duracionMeses: 3 }]).ok, false);
  assert.equal(validarCambiosEnBloque([{ planId: "x'; drop", controlesPrevistos: 3 }]).ok, false);
  assert.equal(validarCambiosEnBloque("todo").ok, false);
  assert.equal(validarCambiosEnBloque(Array.from({ length: 61 }, (_, i) => ({ planId: `p${i}`, controlesPrevistos: 3 }))).ok, false);
});

test("lo que el servidor no aplica: marca en caso no migrado, doctor encima de otro, plan sin columna", () => {
  const base = { migrado: true, doctorId: null, planGuardable: true };
  assert.equal(motivoParaNoAplicar({ planId: "a", migradoSinDiagnostico: true }, base), null);
  assert.match(motivoParaNoAplicar({ planId: "a", migradoSinDiagnostico: true }, { ...base, migrado: false }) ?? "", /solo va en casos que vinieron de otro sistema/);
  // Quitar la marca sí se puede siempre.
  assert.equal(motivoParaNoAplicar({ planId: "a", migradoSinDiagnostico: false }, { ...base, migrado: false }), null);
  assert.match(motivoParaNoAplicar({ planId: "a", doctorId: "d2" }, { ...base, doctorId: "d1" }) ?? "", /Datos del caso/);
  assert.equal(motivoParaNoAplicar({ planId: "a", doctorId: "d1" }, { ...base, doctorId: "d1" }), null);
  assert.match(motivoParaNoAplicar({ planId: "a", controlesPrevistos: 3 }, { ...base, planGuardable: false }) ?? "", /ortodoncia-plan-de-tratamiento\.sql/);
});

test("cableado: Alertas y Tablero calculan con la regla nueva; «Editar plan» conserva la marca", () => {
  const db = sinComentarios(leer("lib/orthodontics/casos-incompletos-db.ts"));
  assert.match(db, /casoMigrado: migrado,/);
  assert.match(db, /colocado: estaColocado\(\{ installedAt: f\.installedAt, status: c\.status \}\)/);
  assert.match(db, /retentionPlanText: true/);
  const guardar = sinComentarios(leer("lib/orthodontics/plan-detalle-guardar.ts"));
  assert.match(guardar, /actual\.migradoSinDiagnostico \? \{ migradoSinDiagnostico: true as const \} : \{\}/);
});

test("la acción en bloque: permiso clínico, clínica de la sesión, visibilidad, misma vía de guardado que «Editar plan»", () => {
  const a = sinComentarios(leer("app/actions/orthodontics/modulo/completarCasosEnBloque.ts"));
  assert.match(a, /^"use server";/);
  assert.match(a, /getOrthoActionContext\(\)/, "pide medicalRecord.edit (write por omisión)");
  assert.match(a, /clinicId: ctx\.clinicId, id: \{ in: ids \}, deletedAt: null/);
  assert.match(a, /canSeePatient\(viewer, c\.patient\.visibleUserIds\)/);
  assert.match(a, /aplicarPlanDetalle\(\{/);
  assert.match(a, /validarPersonasDelCaso\(\{/);
  assert.match(a, /treatingDoctorId: null \},\s*data: \{ treatingDoctorId: cambio\.doctorId \}/, "no pisa un doctor puesto en medio");
  assert.match(a, /registrarMovimientoDelPaciente\(\{/);
  const pagina = sinComentarios(leer("app/dashboard/orthodontics/completar/page.tsx"));
  assert.match(pagina, /exigirModuloOrtodoncia\(\)/);
  assert.match(pagina, /"medicalRecord\.edit"/);
});

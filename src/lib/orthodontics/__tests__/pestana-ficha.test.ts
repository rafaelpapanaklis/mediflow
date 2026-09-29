/**
 * La pestaña «Ortodoncia» de la ficha del paciente (Rafael, 28-sep-2026).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/pestana-ficha.test.ts
 *
 * Los tres casos:
 *  1. Sin el módulo en la sede: la pestaña no aparece.
 *  2. Con el módulo y un paciente que tiene o TUVO caso: la pestaña completa.
 *  3. Con el módulo y un paciente que NUNCA tuvo caso: solo «Abrir caso».
 * Y que la pestaña es visible en el menú de la ficha, no escondida en «Más».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { etiquetaAbrirCaso, pistaSinCaso, tituloSinCaso } from "@/components/specialties/orthodontics/redesign/casos-migrados-texto";
import { buildPatientNavItems } from "@/components/dashboard/patient-detail/patient-nav-items";
import { FIJOS, construirMenuFicha } from "@/components/dashboard/pacientes-rediseno/menu-estructura";
import { ESTADOS_QUE_CUENTAN_COMO_CASO, vistaDePestanaOrto } from "../pestana-ficha";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const NAV = {
  pediatrics: { state: "hidden" as const },
  showPeriodontics: false,
  showEndodontics: false,
  showImplants: false,
  showOrthodontics: true,
  showBilling: true,
  showConsents: true,
  showXrays: true,
  showPrescriptions: true,
};

// ── Caso 1: sin el módulo ────────────────────────────────────────────────

test("caso 1 — sin el módulo en la sede, la pestaña no aparece", () => {
  assert.equal(vistaDePestanaOrto({ moduloActivo: false, tienePlan: false, tieneDiagnostico: false }), "oculta");
  // Ni aunque el paciente tuviera un caso de cuando la sede sí lo tenía.
  assert.equal(vistaDePestanaOrto({ moduloActivo: false, tienePlan: true, tieneDiagnostico: true }), "oculta");

  const items = buildPatientNavItems({ ...NAV, showOrthodontics: false });
  assert.ok(!items.some((i) => i.id === "ortodoncia"));
  const menu = construirMenuFicha(items);
  assert.deepEqual(
    menu.fijos.map((i) => i.id),
    ["resumen", "expediente", "odontograma", "tratamiento", "agenda", "facturacion"],
    "la barra queda en los seis de siempre",
  );
  assert.ok(!menu.grupos.some((g) => g.items.some((i) => i.id === "ortodoncia")));

  // La ficha solo enciende la pestaña cuando llegan los datos de ortodoncia
  // (o la cara administrativa, X2), y esos solo se cargan si la sede tiene el
  // módulo de verdad —o conserva la lectura de un caso, decisión 3— y la
  // persona tiene las llaves (vistaOrtoPorPermisos).
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /const hayDatosOrto = orthoData !== null && orthoData !== undefined;/);
  assert.match(ficha, /const showOrthodontics = hayDatosOrto \|\| orthoSoloAdministrativo;/);
  const pagina = leer("src/app/dashboard/patients/[id]/page.tsx");
  assert.match(pagina, /await hasActiveOrthodonticsModule\(user\.clinicId\)/);
  assert.match(pagina, /if \(orthoVista === "clinica"\) \{\s*const redesign = await loadOrthoRedesignData\(/);
});

// ── Caso 2: tiene o tuvo caso ────────────────────────────────────────────

test("caso 2 — con el módulo y un caso en CUALQUIER estado, la pestaña completa", () => {
  assert.equal(vistaDePestanaOrto({ moduloActivo: true, tienePlan: true, tieneDiagnostico: true }), "completa");
  // Un plan sin diagnóstico a la vista (datos viejos) sigue siendo un caso.
  assert.equal(vistaDePestanaOrto({ moduloActivo: true, tienePlan: true, tieneDiagnostico: false }), "completa");
  // Valorado o en observación: todavía sin plan, pero con historial que enseñar.
  assert.equal(vistaDePestanaOrto({ moduloActivo: true, tienePlan: false, tieneDiagnostico: true }), "completa");

  assert.deepEqual(
    [...ESTADOS_QUE_CUENTAN_COMO_CASO].sort(),
    ["COMPLETED", "DROPPED_OUT", "IN_PROGRESS", "ON_HOLD", "PLANNED", "RETENTION"],
    "abierto, en pausa, en retención, terminado y abandonado: todos",
  );
  // El cargador trae el ÚLTIMO plan del paciente sin mirar su estado: uno
  // terminado o abandonado llega igual, y por eso cuenta.
  const cargador = leer("src/lib/orthodontics/load-data.ts");
  assert.match(cargador, /const where = \{ patientId, clinicId, deletedAt: null \} as const;/);
  const busqueda = cargador.slice(cargador.indexOf("async function fetchPlanTolerante"));
  assert.doesNotMatch(busqueda.slice(0, 900), /status:/, "no filtra por estado");
});

// ── Caso 3: nunca tuvo caso ──────────────────────────────────────────────

test("caso 3 — con el módulo y sin caso nunca, solo «Abrir caso de ortodoncia»", () => {
  assert.equal(vistaDePestanaOrto({ moduloActivo: true, tienePlan: false, tieneDiagnostico: false }), "solo-abrir-caso");

  // La pestaña sale igual en el menú.
  assert.ok(buildPatientNavItems(NAV).some((i) => i.id === "ortodoncia"));

  const pestana = leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(pestana, /moduloActivo: orthoData !== null && orthoData !== undefined,/);
  assert.match(pestana, /tienePlan: Boolean\(orthoData\?\.plan\),/);
  assert.match(pestana, /tieneDiagnostico: Boolean\(orthoData\?\.diagnosis\),/);
  assert.match(
    pestana,
    /if \(vista === "solo-abrir-caso"\) \{\s*return \(\s*<OrtodonciaSinCaso\s+patientId=\{patient\.id\}\s+patientFullName=\{fullName\}\s+onCreateCase=\{crearCaso\}/,
  );
  // La salida va ANTES de montar la pestaña completa: sus secciones no llegan a pintarse.
  assert.ok(pestana.indexOf('if (vista === "solo-abrir-caso")') < pestana.indexOf("<OrthodonticsRedesignClient"));

  const limpia = sinComentarios(leer("src/components/specialties/orthodontics/redesign/OrtodonciaSinCaso.tsx"));
  // El texto sale de funciones puras: sin casos migrados el paciente ve lo de siempre; con ellos, «Sin caso activo…».
  assert.equal(etiquetaAbrirCaso(0), "Abrir caso de ortodoncia");
  assert.equal(tituloSinCaso("Ana Prueba", 0), "Ana Prueba no tiene caso de ortodoncia");
  assert.match(limpia, /etiquetaAbrirCaso\(nMigrados\)/);
  assert.match(limpia, /tituloSinCaso\(patientFullName, nMigrados\)/);
  assert.match(limpia, /<DrawerNewCase/, "el asistente de alta de siempre, no otro");
  // Una vista limpia: ninguna sección del expediente de ortodoncia.
  assert.doesNotMatch(limpia, /Section[A-Z]\w+|RightRail|ResumenCobranza|AlineadoresPanel|HygieneTrendCard|OrthodonticsModuleSidebar/);
  assert.equal((limpia.match(/<section\b/g) ?? []).length, 1, "una sola tarjeta");
  // Y quien llega desde «Abrir caso» del módulo encuentra el asistente abierto.
  assert.match(limpia, /useAbrirAltaAlLlegar\(\{ tieneCaso: false, puedeCrear: true, abrir: \(\) => setAltaAbierta\(true\) \}\);/);
});

test("las dos caras abren el caso con la misma función", () => {
  const pestana = leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.equal((pestana.match(/onCreateCase=\{crearCaso\}/g) ?? []).length, 2);
  assert.equal((pestana.match(/await createTreatmentPlan\(/g) ?? []).length, 1, "un solo camino para crear el plan");
  const completa = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(completa, /useAbrirAltaAlLlegar\(\{/);
});

// ── La pestaña, a la vista ───────────────────────────────────────────────

test("«Ortodoncia» es una pestaña visible de la ficha, no va dentro de «Más»", () => {
  const menu = construirMenuFicha(buildPatientNavItems(NAV));
  assert.deepEqual(
    menu.fijos.map((i) => i.id),
    ["resumen", "expediente", "odontograma", "tratamiento", "agenda", "facturacion", "ortodoncia"],
    "los seis acordados no se mueven; Ortodoncia va detrás",
  );
  assert.ok(!menu.grupos.some((g) => g.id === "mas"), "«Más» ni se pinta");
  assert.ok(!menu.grupos.some((g) => g.items.some((i) => i.id === "ortodoncia")));
  assert.ok((FIJOS as readonly string[]).includes("ortodoncia"));
});

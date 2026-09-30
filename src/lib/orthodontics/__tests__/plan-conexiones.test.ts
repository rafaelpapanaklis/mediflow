/**
 * ws1-t12 — el Plan de tratamiento y sus CONEXIONES: que cada lugar que lo lee (cobro, progreso, alertas,
 * procedimientos, PDF, expediente, Sabina, Movimientos, importador) siga cableado a la MISMA fuente, y que el SQL y las
 * acciones cumplan las reglas de la casa. Es un recorrido del código: el detalle de cada regla se prueba en
 * plan-detalle.test.ts, plan-detalle-guardar.test.ts, cambiarCostoDelCaso.test.ts y ventana-del-caso.test.ts.
 *
 * Run: npm run test:orto-plan-detalle
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const RAIZ = join(SRC, "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("1 · Cobro: controles previstos × precio del control = estimado (Cobro y convenio); «Control X de N» en «Precio total»", () => {
  const panel = sinComentarios(leer("app/actions/orthodontics/cobro/cargarPanelDeCobro.ts"));
  assert.match(panel, /estimado: billingMode === "PAGO_POR_CONTROL" \? estimadoPorControles\(previstos, precioPorControl\) : null/);
  assert.match(panel, /cargarProgresoDeControles\(/);
  assert.match(panel, /borradorInicialDelCaso\(\{ \.\.\.caso, aparatologia \}/, "la colocación lleva la aparatología elegida en su concepto");
  assert.match(sinComentarios(leer("components/specialties/orthodontics/redesign/sections/SectionFinance.tsx")), /<ControlesDelPlan datos=\{panel\.controlesDelPlan\} porControl=\{esPorControl\} \/>/);
  const convenio = sinComentarios(leer("lib/orthodontics/pdf/convenio.ts"));
  assert.match(convenio, /estimadoPorControles\(e\.controlesPrevistos, e\.precioPorControl\)/);
  assert.match(convenio, /\(estimado\)/, "sale como ESTIMADO, no como cobro");
  assert.match(sinComentarios(leer("app/actions/orthodontics/exportFinancialAgreementPdf.ts")), /controlesPrevistos: panel\.controlesDelPlan\?\.previstos \?\? null/);
  // Nada cobra solo: ni el panel ni el estimado crean facturas.
  assert.doesNotMatch(panel, /invoice\.create|crearPlanDelCaso\(/);
});

test("2 · Progreso «Control X de N»: ficha, Tablero y Controles cuentan con la MISMA función", () => {
  assert.match(sinComentarios(leer("lib/orthodontics/redesign/loader.ts")), /contarControlesHechos\(/);
  assert.match(sinComentarios(leer("lib/orthodontics/controles-hechos-db.ts")), /contarControlesHechos\(/);
  assert.match(sinComentarios(leer("lib/orthodontics/tablero-data.ts")), /numerarCitasPorAtender\(/);
  assert.match(sinComentarios(leer("lib/orthodontics/controles-data.ts")), /numerarCitasPorAtender\(/);
  assert.match(sinComentarios(leer("components/specialties/orthodontics/modulo/vista-tablero.tsx")), /textoControlQueSigue\(/);
  assert.match(sinComentarios(leer("components/specialties/orthodontics/modulo/vista-controles.tsx")), /textoControlQueSigue\(/);
  assert.match(sinComentarios(leer("components/specialties/orthodontics/redesign/sections/SectionHero.tsx")), /textoControlesHechos\(props\.controles\)/);
  // Una sola cuenta de visitas: la de la ficha (`visitasDelCaso`).
  assert.match(sinComentarios(leer("lib/orthodontics/controles-hechos.ts")), /visitasDelCaso\(/);
});

test("3 · Alertas: reevaluación radiográfica (fecha o periodicidad) y casos incompletos; la reevaluación se puede posponer", () => {
  const alertas = sinComentarios(leer("lib/orthodontics/alerts-data.ts"));
  assert.match(alertas, /reevaluacionesPendientes\(/);
  assert.match(alertas, /quitarPospuestas\(reevaluaciones, "reevaluacion-radiografica", activas\)/);
  assert.match(alertas, /cargarCasosIncompletos\(clinicId, cases\)/);
  assert.match(sinComentarios(leer("lib/orthodontics/tablero-data.ts")), /cargarCasosIncompletos\(clinicId, cases\)/);
  assert.match(leer("lib/orthodontics/alertas-pospuestas.ts"), /"reevaluacion-radiografica"/);
  // Las dos rutas del SQL de posponer aceptan el tipo nuevo.
  assert.match(leer("../sql/ortodoncia-alertas-pospuestas.sql"), /'reevaluacion-radiografica'/);
  assert.match(leer("../sql/ortodoncia-plan-de-tratamiento.sql"), /'reevaluacion-radiografica'/);
  // Los accesos directos abren la ventana en el paso que falta, y la ficha los atiende.
  assert.match(sinComentarios(leer("lib/orthodontics/casos-incompletos-ruta.ts")), /\?tab=ortodoncia&\$\{PARAMETRO_COMPLETAR\}=\$\{paso\}/);
  assert.match(sinComentarios(leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx")), /useCompletarAlLlegar\(/);
});

test("4 · Procedimientos: lo que el plan pide se propone primero en la hoja y en «Cobrar extra»", () => {
  assert.match(sinComentarios(leer("app/actions/orthodontics/procedimientosDeHoja.ts")), /procedimientosSugeridos\(planDetalle, catalogo\)/);
  assert.match(sinComentarios(leer("app/actions/orthodontics/cobro/cargarPanelDeCobro.ts")), /procedimientosSugeridos\(planDetalle, filasDeExtras\)/);
  assert.match(leer("components/specialties/orthodontics/redesign/drawers/DrawerCobrarExtra.tsx"), /Del plan de tratamiento de este caso/);
  assert.match(leer("components/specialties/orthodontics/redesign/drawers/ProcedimientosDeVisita.tsx"), /Del plan de tratamiento de este caso/);
  // Las extracciones de la hoja se marcan como realizadas en el plan al FIRMAR (no en el borrador).
  assert.match(sinComentarios(leer("app/actions/orthodontics/signTreatmentCard.ts")), /marcarExtraccionesDesdeLaHoja\(/);
  assert.doesNotMatch(sinComentarios(leer("app/actions/orthodontics/saveTreatmentCardDraft.ts")), /extraccionesRealizadas/);
});

test("5 · PDF del plan, expediente PDF y Sabina leen el plan completo con la MISMA redacción (lineasDelPlan)", () => {
  assert.match(sinComentarios(leer("app/actions/orthodontics/exportTreatmentPlanPdf.ts")), /lineasDelPlan\(/);
  assert.match(sinComentarios(leer("lib/orthodontics/expediente-ortodoncia.ts")), /lineasDelPlan\(/);
  assert.match(sinComentarios(leer("lib/sabina/tools/orto-motor.ts")), /lineasDelPlan\(/);
  assert.match(sinComentarios(leer("lib/pdf/expediente-document.tsx")), /caso\.planDeTratamiento/);
  assert.match(sinComentarios(leer("lib/orthodontics/pdf-templates/treatment-plan.tsx")), /Detalle del plan de tratamiento/);
  // Sabina solo LEE: la herramienta no importa nada que escriba el plan.
  for (const f of ["lib/sabina/tools/orto-caso.ts", "lib/sabina/tools/orto-motor.ts"]) {
    assert.doesNotMatch(sinComentarios(leer(f)), /aplicarPlanDetalle|guardarPlanCompleto|actualizarPlanDetalle|guardarPlanDeTratamiento/, f);
  }
});

test("6 · Movimientos: cada cambio del plan deja su frase humana, con el paciente como campo propio", () => {
  const g = sinComentarios(leer("lib/orthodontics/plan-detalle-guardar.ts"));
  assert.match(g, /registrarMovimientoDelPaciente\(\{[\s\S]*?patientId,[\s\S]*?entityType: "orthodontic-plan"/);
  assert.match(g, /texto: textoDeMovimientoDelPlan\(cambios\.secciones, args\.creado === true\)/);
  assert.match(sinComentarios(leer("lib/orthodontics/plan-completo.ts")), /registrarMovimientoDelPaciente\(/);
  assert.match(sinComentarios(leer("app/actions/orthodontics/cobro/cambiarCostoDelCaso.ts")), /registrarMovimientoDelPaciente\(/);
});

test("7 · Importador: el mapeo de Dentalink al plan está preparado (todavía sin cablear a un manejador)", () => {
  const m = sinComentarios(leer("lib/import/dentalink/plan-detalle-mapeo.ts"));
  assert.match(m, /export function planDetalleDesdeDentalink\(/);
  assert.match(m, /normalizarPlanDetalle\(crudo\)/, "pasa por la MISMA normalización que el servidor");
});

test("una sola fuente: nada del plan nuevo se duplica en una columna de Prisma (todo por SQL crudo con sonda)", () => {
  const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
  assert.doesNotMatch(schema, /planDetalle|planOptions/, "las columnas nuevas NO se declaran en schema.prisma");
  const db = sinComentarios(leer("lib/orthodontics/plan-detalle-db.ts"));
  assert.match(db, /information_schema\.columns/);
  assert.match(db, /"planDetalle"/);
  assert.match(db, /"planOptions"/);
});

test("el SQL es aditivo, plano e idempotente: sin DO, sin DROP de tablas ni columnas, sin tocar filas", () => {
  const sql = leer("../sql/ortodoncia-plan-de-tratamiento.sql");
  const codigo = sql.replace(/^--.*$/gm, "");
  assert.match(codigo, /ADD COLUMN IF NOT EXISTS "planDetalle" JSONB/);
  assert.match(codigo, /ADD COLUMN IF NOT EXISTS "planOptions" JSONB/);
  assert.doesNotMatch(codigo, /\bDO\b\s*\$\$|\bBEGIN\b/i);
  assert.doesNotMatch(codigo, /DROP\s+(TABLE|COLUMN|SCHEMA)/i);
  assert.doesNotMatch(codigo, /\b(DELETE|TRUNCATE|UPDATE)\b/i);
  assert.match(codigo, /DROP CONSTRAINT IF EXISTS "ortho_alert_snoozes_tipo_check"/, "el único DROP es el de una restricción, con IF EXISTS");
  assert.match(codigo, /ALTER TABLE IF EXISTS "ortho_alert_snoozes"/, "si esa tabla aún no existe, no falla");
});

test("las acciones nuevas: «use server» solo exporta funciones async, la clínica sale de la sesión y el permiso va primero", () => {
  for (const f of ["guardarPlanDeTratamiento.ts", "guardarDiagnosticoYPlan.ts", "guardarOpcionesDelPlan.ts", "cargarOpcionesDelPlan.ts", "cobro/cambiarCostoDelCaso.ts"]) {
    const a = sinComentarios(leer(`app/actions/orthodontics/${f}`));
    assert.match(a, /^"use server";/m, f);
    assert.deepEqual([...a.matchAll(/^export (?!async function)(\w+ ?\w*)/gm)].map((m) => m[1]).filter((x) => !/^type\b|^interface\b/.test(x)), [], f);
    assert.doesNotMatch(a, /clinicId: (input|args|o)\b|input\??\.clinicId|args\??\.clinicId/, `${f}: la clínica no viene del cliente`);
  }
  // El permiso va antes de tocar nada (la validación y el caso los lee `prepararGuardadoDelPlan`, ya con la sesión).
  for (const f of ["guardarPlanDeTratamiento.ts", "guardarDiagnosticoYPlan.ts"]) {
    const t = leer(`app/actions/orthodontics/${f}`);
    assert.ok(t.indexOf("getOrthoActionContext()") > 0 && t.indexOf("getOrthoActionContext()") < t.indexOf("prepararGuardadoDelPlan("), f);
  }
  assert.ok(leer("app/actions/orthodontics/cobro/cambiarCostoDelCaso.ts").indexOf('getOrthoBillingActionContext("billing.edit")') < leer("app/actions/orthodontics/cobro/cambiarCostoDelCaso.ts").indexOf("prisma."));
  // Configuración de la clínica: permiso de ajustes, no clínico.
  assert.match(leer("app/actions/orthodontics/guardarOpcionesDelPlan.ts"), /getOrthoConfigActionContext\(\)/);
});

test("diseño: sin colores escritos a mano, sin prefijos de anuncio (ad-, banner-, promo-) y sin clases del cajón lateral", () => {
  const css = leer("components/specialties/orthodontics/redesign/plan-tratamiento.module.css");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /\brgba?\(/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  for (const token of ["--pr-tarjeta", "--pr-borde", "--pr-texto", "--pr-activo-suave", "--orto-violeta"]) assert.match(css, new RegExp(token));
  const clases = [...css.matchAll(/^\.([A-Za-z][\w-]*)/gm)].map((m) => m[1]!);
  assert.ok(clases.length > 40);
  assert.deepEqual(clases.filter((c) => /^(ad|ads|adv|banner|promo|sponsor)[-A-Z_]/i.test(c)), [], "EasyList/AdGuard ocultan esas clases");
  // Teléfono: una columna, navegación en tira, chips de 40 px.
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.popupCuerpo \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.chip,\s*\.segmento \{[^}]*min-height: 40px;/);
});

test("nadie del módulo abre «Abrir caso» ni «Editar plan» por otra ventana: una sola (DrawerNewCase) para crear y para editar", () => {
  const dir = join(SRC, "components/specialties/orthodontics");
  const archivos: string[] = [];
  const recorrer = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.tsx$/.test(n) && !p.includes("__tests__")) archivos.push(p);
    }
  };
  recorrer(dir);
  const duplicadas = archivos.filter((f) => /DrawerEditPlanDeTratamiento/.test(readFileSync(f, "utf8")));
  assert.deepEqual(duplicadas, [], "no quedó una versión básica del editor del plan");
  const cliente = sinComentarios(leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx"));
  assert.match(cliente, /<DrawerNewCase\s+modo="editar"/);
  assert.match(cliente, /vista=\{props\.planDeTratamiento\}/);
});

test("segunda pasada (t9): «Cobrar extra» y la hoja avisan del procedimiento que falta; nada de filas vacías; un solo movimiento al guardar el plan", () => {
  const panel = sinComentarios(leer("app/actions/orthodontics/cobro/cargarPanelDeCobro.ts"));
  assert.match(panel, /procedimientosFaltantes = procedimientosQueFaltanEnElCatalogo\(planDetalle, filasCatalogo\.filter\(\(f\) => f\.isActive\)\)/);
  assert.match(sinComentarios(leer("app/actions/orthodontics/procedimientosDeHoja.ts")), /procedimientosFaltantes: procedimientosQueFaltanEnElCatalogo\(planDetalle, catalogo\)/);
  const cobrar = sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerCobrarExtra.tsx"));
  assert.match(cobrar, /avisoDeProcedimientoFaltante\(item\)/);
  assert.match(cobrar, /href="\/dashboard\/procedures"/);
  // Tubos/bandas/cementación y aparatología: solo filas con dato.
  const plan = sinComentarios(leer("components/specialties/orthodontics/redesign/sections/SectionPlanDeTratamiento.tsx"));
  assert.match(plan, /\{d\.bandasSuperiores \|\| d\.bandasInferiores \? \(/);
  assert.match(plan, /\{d\.cementacionInferiorAnterior \|\| d\.cementacionInferiorPosterior \? \(/);
  const aparatologia = sinComentarios(leer("components/specialties/orthodontics/redesign/sections/SectionPlan.tsx"));
  assert.match(aparatologia, /treatment\.appliance\.bonding \? <PrescriptionTile label="Cementado"/);
  assert.match(aparatologia, /treatment\.appliance\.notes \? <PrescriptionTile label="Notas"/);
  // Un «Guardar plan» que solo cambió el plan completo no llama a updateTreatmentPlan (dejaba su propio movimiento genérico).
  const tab = sinComentarios(leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"));
  assert.match(tab, /if \(p\.columnasCambiaron\) \{\s*const cols = await updateTreatmentPlan\(/);
  assert.match(sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx")), /const columnasCambiaron =/);
});

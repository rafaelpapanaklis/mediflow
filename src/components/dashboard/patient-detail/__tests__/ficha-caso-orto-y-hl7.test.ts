/**
 * WS1-T4 ronda 6 — cableado de la ficha: el caso de ortodoncia llega a la
 * portada y a «Plan», y la exportación HL7 vive en el menú ⋯ de la cabecera.
 *
 * Run: npx tsx --test src/components/dashboard/patient-detail/__tests__/ficha-caso-orto-y-hl7.test.ts
 *
 * Se prueba leyendo el código, como el resto de candados de la ficha: lo que
 * se vigila es que el cableado no se pierda en un archivo que tocan muchos.
 *
 * Tres pruebas van marcadas `todo`: describen el cableado que FALTA en
 * `patient-detail-client.tsx` (pasar `casoOrtodoncia` a la portada y a Plan, y
 * quitar el botón de las migas). Ese archivo lo tenía otra pantalla a medias
 * al cerrar la ronda. Al cablear, quitar el `todo`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (c: string) =>
  c
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const ficha = sinComentarios(leer("app/dashboard/patients/[id]/patient-detail-client.tsx"));
const cabecera = sinComentarios(leer("components/dashboard/patient-detail/hero-card.tsx"));
const es = JSON.parse(leer("i18n/dictionaries/es.json"));
const en = JSON.parse(leer("i18n/dictionaries/en.json"));

const bloque = (inicio: string) => {
  const i = ficha.indexOf(inicio);
  assert.ok(i >= 0, `no se encontró ${inicio}`);
  return ficha.slice(i, ficha.indexOf("/>", i));
};

// ── F2: el caso de ortodoncia ────────────────────────────────────────────

test("el resumen del caso sale de lo ya cargado y solo con módulo y permisos", { todo: "pendiente: cablear en patient-detail-client.tsx cuando quede libre (ws1-t4 ronda 6)" }, () => {
  assert.match(
    ficha,
    /const casoOrtodoncia = useMemo\(\s*\(\) => \(showOrthodontics \? resumenOrtoParaFicha\(orthoData\) : null\)/,
  );
  // Ni una consulta nueva: el archivo puro no sabe de prisma ni de fetch.
  const puro = sinComentarios(leer("lib/orthodontics/resumen-para-ficha.ts"));
  assert.doesNotMatch(puro, /prisma|fetch\(|from "react"|^import /m);
});

test("la portada y la pestaña Plan reciben el caso", { todo: "pendiente: cablear en patient-detail-client.tsx cuando quede libre (ws1-t4 ronda 6)" }, () => {
  assert.ok(bloque("<ResumenRediseno").includes("casoOrtodoncia={casoOrtodoncia}"));
  const plan = bloque("<PlanTratamientoRediseno");
  assert.ok(plan.includes("casoOrtodoncia={casoOrtodoncia}"));
  assert.ok(plan.includes('onAbrirCaso={() => setTab("ortodoncia")}'));
});

test("«Abrir caso» lleva a la pestaña ortodoncia y el caso cerrado no cuenta", () => {
  const resumen = sinComentarios(leer("components/dashboard/pacientes-rediseno/resumen.tsx"));
  assert.ok((resumen.match(/onIrA\("ortodoncia"\)/g) ?? []).length >= 2, "faltan las dos puertas al caso");
  assert.match(resumen, /casoOrtodoncia && casoOrtodoncia\.abierto \? casoOrtodoncia : null/);
  const plan = sinComentarios(leer("components/dashboard/expediente-rediseno/plan-tratamiento.tsx"));
  assert.match(plan, /casoOrtodoncia && casoOrtodoncia\.abierto \? casoOrtodoncia : null/);
  assert.match(plan, /casoOrto \? t\("pacientesRediseno\.casoOrto\.sinPlanesGenerales"\) : t\("planTratamiento\.lista\.vacio"\)/);
});

// ── F5: la exportación HL7 ───────────────────────────────────────────────

test("la exportación HL7 ya no está en las migas de la ficha", { todo: "pendiente: cablear en patient-detail-client.tsx cuando quede libre (ws1-t4 ronda 6)" }, () => {
  assert.doesNotMatch(ficha, /export-cda/);
  assert.doesNotMatch(ficha, /patients\.export\.cdaLabel/);
});

test("está en «Más acciones del paciente», con la misma acción", () => {
  const menu = cabecera.slice(cabecera.indexOf("<Popover.Content"), cabecera.indexOf("</Popover.Content>"));
  assert.match(menu, /window\.location\.href = `\/api\/patients\/\$\{patient\.id\}\/export-cda`/);
  assert.match(menu, /t\("patients\.heroCard\.exportHl7"\)/);
  // Mismos permisos que el botón de antes: se ofrece a todos y decide la ruta.
  const i = menu.indexOf("export-cda");
  const inicio = menu.lastIndexOf("<button", i);
  const boton = menu.slice(inicio, i);
  assert.doesNotMatch(menu.slice(0, inicio).trimEnd(), /&&\s*\($/, "el ítem no va detrás de una condición");
  assert.match(boton, /className=\{styles\.heroMenuItem\}/);
});

test("los textos están en los dos idiomas", () => {
  assert.equal(es.patients.heroCard.exportHl7, "Exportar expediente (formato HL7)");
  assert.equal(typeof en.patients.heroCard.exportHl7, "string");
  assert.notEqual(en.patients.heroCard.exportHl7, es.patients.heroCard.exportHl7);
});

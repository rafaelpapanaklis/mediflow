/**
 * Retención sin caso abierto — H18d de la QA en vivo (28-sep-2026).
 *
 * Run: npx tsx --test src/components/specialties/orthodontics/redesign/__tests__/retencion-sin-caso.test.ts
 *
 * El hallazgo: «sin caso abierto, Retención muestra retenedores y régimen de
 * ejemplo como si fueran del paciente». Los retenedores de ejemplo ya no
 * salían (aaf61f42); seguía saliendo el calendario de controles («3 meses ·
 * futura»…) y el interruptor de la pre-encuesta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const SECCION = leer("src/components/specialties/orthodontics/redesign/sections/SectionRetention.tsx");
const FICHA = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");

test("H18d: sin caso, Retención dice que no hay caso y no pinta calendario ni interruptor", () => {
  const corte = SECCION.indexOf("if (props.sinCaso && !r && props.checkups.length === 0) {");
  assert.ok(corte > 0, "hay una salida propia para el paciente sin caso");
  const salida = SECCION.slice(corte, SECCION.indexOf("\n  return (\n", corte + 10 + SECCION.slice(corte).indexOf("return (")));
  assert.match(salida, /Aún no hay caso de ortodoncia/);
  assert.doesNotMatch(salida, /defaultCheckups\(\)/, "sin el calendario de relleno");
  assert.doesNotMatch(salida, /PreSurveyToggle/, "sin el interruptor de la pre-encuesta");
  assert.doesNotMatch(salida, /Configurar régimen/, "sin caso no hay régimen que configurar");
  // Y va ANTES de todo lo demás: nada de lo de abajo se llega a pintar.
  assert.ok(corte < SECCION.indexOf("Nadie configuró el régimen de retención todavía"));
});

test("«sin caso» es no tener plan de tratamiento, no el estado por defecto", () => {
  assert.match(FICHA, /sinCaso=\{!t\.treatmentPlanId\}/);
  // `treatmentStatus` cae en «en-tratamiento» cuando no hay nada cargado: no sirve para esto.
  assert.match(FICHA, /const tStatus = props\.treatmentStatus \?\? "en-tratamiento";/);
  assert.doesNotMatch(SECCION, /treatmentStatus === "no-iniciado" && !r/);
});

test("con caso abierto todo sigue igual: aviso de régimen sin configurar y calendario previo", () => {
  assert.match(SECCION, /Nadie configuró el régimen de retención todavía/);
  assert.match(SECCION, /props\.checkups\.length > 0 \? props\.checkups : defaultCheckups\(\)/);
  assert.match(SECCION, /<PreSurveyToggle/);
});

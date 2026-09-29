// ws1-t10 (fila S1 de la revisión final) — las sugerencias de inicio de Sabina incluyen una
// de ortodoncia si la clínica tiene el módulo; y Sabina dice «Por colocar», como el módulo.
// Correr: npx tsx --test src/components/sabina/__tests__/sugerencias-ortodoncia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SABINA_SUGGESTIONS, SABINA_SUGERENCIA_ORTODONCIA, sugerenciasDeInicio } from "../sabina-core";
import { ETIQUETA_ESTADO_CASO } from "@/lib/orthodontics/resumen-para-ficha";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("sin Ortodoncia: las cinco de siempre (y dos en el cajón)", () => {
  assert.deepEqual(sugerenciasDeInicio({ compacto: false, conOrtodoncia: false }), SABINA_SUGGESTIONS);
  assert.equal(sugerenciasDeInicio({ compacto: true, conOrtodoncia: false }).length, 2);
});

test("con Ortodoncia: sigue habiendo cinco y una es de ortodoncia; el cajón la trae en su segundo lugar", () => {
  const completa = sugerenciasDeInicio({ compacto: false, conOrtodoncia: true });
  assert.equal(completa.length, SABINA_SUGGESTIONS.length);
  assert.ok(completa.includes(SABINA_SUGERENCIA_ORTODONCIA));
  assert.match(SABINA_SUGERENCIA_ORTODONCIA.text, /ortodoncia/i);
  const cajon = sugerenciasDeInicio({ compacto: true, conOrtodoncia: true });
  assert.equal(cajon.length, 2);
  assert.equal(cajon[1], SABINA_SUGERENCIA_ORTODONCIA);
  assert.equal(cajon[0], SABINA_SUGGESTIONS[0]);
});

test("la pregunta de ortodoncia no repite ninguna de las cinco genéricas", () => {
  assert.ok(!SABINA_SUGGESTIONS.some((s) => s.text === SABINA_SUGERENCIA_ORTODONCIA.text));
});

test("el indicador llega de los dos sitios: el layout (cajón) y la pantalla de Sabina", () => {
  assert.match(leer("app/dashboard/layout.tsx"), /<SabinaLanzador [^>]*conOrtodoncia=\{orthodonticsModuleActive\}/);
  const p = leer("app/dashboard/sabina/page.tsx");
  assert.match(p, /hasActiveOrthodonticsModule\(user\.clinicId\)/);
  assert.match(p, /conOrtodoncia=\{conOrtodoncia\}/);
  assert.match(leer("components/sabina/sabina-conversacion.tsx"), /sugerenciasDeInicio\(\{ compacto: !!compacto, conOrtodoncia: !!conOrtodoncia \}\)/);
});

test("Sabina dice «Por colocar» donde el módulo lo dice, y ya no «planeado(s)»", () => {
  for (const f of ["lib/sabina/tools/orto-caso.ts", "lib/sabina/tools/orto-controles.ts"]) {
    const src = leer(f);
    assert.ok(src.includes(`PLANNED: "${ETIQUETA_ESTADO_CASO.planeado}"`), f);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /[Pp]laneados?/, f);
  }
  assert.match(leer("lib/sabina/tools/orto-controles.ts"), /"Por colocar": \["por colocar", "por colocar"\]/);
});

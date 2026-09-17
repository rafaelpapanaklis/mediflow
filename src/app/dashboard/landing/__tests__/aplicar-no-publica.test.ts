/**
 * CANDADOS DE «PÁGINA WEB» (ws1-t2): nada publica por accidente.
 *
 * Run: npx tsx --test src/app/dashboard/landing/__tests__/aplicar-no-publica.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO. `landingActive` decide si los PACIENTES ven el sitio, así
 * que solo puede cambiarlo el interruptor «Publicada / Oculta», que es donde
 * el usuario lo pide explícitamente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const cliente = leer("app/dashboard/landing/landing-config-client.tsx");

test("aplicar una plantilla NO manda landingActive", () => {
  const cuerpo = cliente.slice(cliente.indexOf("async function applyTemplate()"), cliente.indexOf("// ── Secciones y fotos guardadas"));
  assert.ok(cuerpo.length > 100, "no se encontró applyTemplate: actualiza este candado");
  const sinComentarios = cuerpo.replace(/\/\/.*$/gm, "");
  assert.ok(!/landingActive\s*:/.test(sinComentarios), "applyTemplate vuelve a mandar landingActive: publicaría sin que nadie lo pida");
  assert.ok(!/updateLocal\("landingActive"/.test(sinComentarios), "applyTemplate vuelve a encender landingActive en local");
  assert.match(sinComentarios, /save\(\{ landingTemplate: templateSel \}/, "applyTemplate ya no guarda SOLO la plantilla");
  assert.match(sinComentarios, /templateAppliedHidden/, "con el sitio oculto no se avisa de que sigue oculto");
});

test("landingActive solo se guarda desde el interruptor, uno por camino", () => {
  const guardados = cliente.match(/save\(\{[^}]*landingActive[^}]*\}/g) ?? [];
  assert.deepEqual(guardados, ["save({ landingActive: newVal }", "save({ landingActive: newVal }"], `hay otro guardado que toca landingActive: ${guardados.join(" | ")}`);
  assert.equal((cliente.match(/role="switch" aria-checked=\{clinic\.landingActive\}/g) ?? []).length, 2, "falta el interruptor de publicar en alguno de los dos caminos");
  // El editor por manifiesto y el editor visual tampoco lo mandan.
  for (const otro of ["app/dashboard/landing/manifest-editor.tsx", "app/dashboard/landing/editor/editor-client.tsx"]) {
    assert.ok(!/landingActive\s*:\s*(true|false|!)/.test(leer(otro)), `${otro} escribe landingActive`);
  }
});

test("el aviso junto a «Aplicar» dice la verdad en los dos caminos y en los dos idiomas", () => {
  assert.ok(!cliente.includes("pages.landing.applyWillPublish"), "sigue el aviso de «Aplicar también publicará tu sitio», que ya no es cierto");
  assert.equal((cliente.match(/\{!clinic\.landingActive &&[\s\S]{0,200}?pages\.landing\.applyKeepsHidden/g) ?? []).length, 2, "el aviso de «seguirá oculto» no está en los dos caminos");
  for (const idioma of ["es", "en"]) {
    const d = JSON.parse(leer(`i18n/dictionaries/${idioma}.json`)).pages.landing;
    for (const k of ["applyKeepsHidden", "templateAppliedHidden", "templateApplied"]) assert.equal(typeof d[k], "string", `${idioma}.json: falta pages.landing.${k}`);
    assert.match(d.templateAppliedHidden, /\{name\}/);
  }
});

test("la vista previa pide el borrador también en el camino de siempre", () => {
  const iframes = cliente.match(/src=\{`\/landing-preview\/\$\{clinic\.slug\}\?preview=\$\{templateSel\}[^`]*`\}/g) ?? [];
  assert.equal(iframes.length, 2, "se esperaban dos iframes de vista previa (nuevo y de siempre)");
  // El del camino de SIEMPRE es el último del archivo (tras «VISTA PREVIA EN VIVO»).
  const viejo = cliente.slice(cliente.lastIndexOf("VISTA PREVIA EN VIVO"));
  assert.match(viejo, /\?preview=\$\{templateSel\}&borrador=1`\}/, "el iframe de siempre no pide ?borrador=1: sin publicar enseña «disponible pronto»");
  // `borrador=1` solo deja VER y lo decide el servidor contra la sesión (PR #331):
  // aquí no se escribe ninguna comprobación de permisos.
  assert.ok(!/hasPermission|landing\.view/.test(viejo), "la pantalla no decide permisos: eso es de /landing-preview");
});

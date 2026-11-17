// «(opcional)» UNA sola vez (QA de cierre D, menor 3, 16-nov).
//   npx tsx --test src/components/barber/cash/__tests__/opcional-una-vez.test.ts
//
// El diálogo «Cerrar turno» decía «Nota del cierre (opcional) (opcional)»: el
// texto del diccionario ya lo traía y la pantalla se lo volvía a colgar con
// `({t("common.optional")})`. Aquí se recorre cada etiqueta de Caja a la que
// la pantalla le cuelga ese sufijo y se exige que su texto NO lo traiga ya,
// en español y en inglés.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";

const CARPETA = path.resolve(__dirname, "..");

function tOf(locale: "es" | "en") {
  const dict = (getBarberDict(locale) as unknown as { barber: { caja: Dictionary } }).barber.caja;
  return makeBarberT(dict);
}

/** Llaves a las que alguna pantalla de Caja les cuelga «({t("common.optional")})». */
function llavesConSufijo(): Array<{ archivo: string; llave: string }> {
  const out: Array<{ archivo: string; llave: string }> = [];
  for (const archivo of fs.readdirSync(CARPETA).filter((f) => f.endsWith(".tsx"))) {
    const src = fs.readFileSync(path.join(CARPETA, archivo), "utf8");
    const re = /\{t\("([\w.]+)"\)\}\s*<span[^>]*>\(\{t\("common\.optional"\)\}\)<\/span>/g;
    for (const m of src.matchAll(re)) out.push({ archivo, llave: m[1] });
  }
  return out;
}

test("la prueba encuentra las etiquetas con sufijo (si el molde cambia, no pasa en vacío)", () => {
  const llaves = llavesConSufijo().map((x) => x.llave);
  assert.ok(llaves.includes("session.closeNotes"), "«Nota del cierre» lleva el sufijo en la pantalla");
  assert.ok(llaves.length >= 5, `se esperaban al menos 5 etiquetas con sufijo, hay ${llaves.length}`);
});

test("ninguna etiqueta con sufijo trae ya «(opcional)» en su texto, ni en es ni en en", () => {
  for (const locale of ["es", "en"] as const) {
    const t = tOf(locale);
    const sufijo = t("common.optional");
    for (const { archivo, llave } of llavesConSufijo()) {
      const texto = t(llave);
      assert.notEqual(texto, llave, `${locale}: ${llave} (${archivo}) tiene texto`);
      assert.ok(
        !texto.toLowerCase().includes(sufijo.toLowerCase()),
        `${locale}: «${texto}» (${llave}, ${archivo}) ya dice «${sufijo}» y la pantalla lo repite`,
      );
    }
  }
});

test("«Nota del cierre» queda como «Nota del cierre (opcional)», una vez", () => {
  const es = tOf("es");
  const en = tOf("en");
  assert.equal(`${es("session.closeNotes")} (${es("common.optional")})`, "Nota del cierre (opcional)");
  assert.equal(`${en("session.closeNotes")} (${en("common.optional")})`, "Closing note (optional)");
});

// C-68 (auditoría de uso): la hoja firmada decía «NiTi superelástico 016» (el catálogo dice .016) y guardaba
// «Clase II 1/4" 6oz» cuando solo se marcó «Clase II». Con el código viejo `textoDeArco` pegaba el calibre tal
// cual y el elástico nuevo nacía con «1/4" 6oz»; `calibreLegible` no existía.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calibreLegible, textoDeArco } from "../material-de-arco";

test("el calibre lleva su punto: «016» → «.016», rectangular «016x022» → «.016×.022»", () => {
  assert.equal(calibreLegible("016"), ".016");
  assert.equal(calibreLegible("016x022"), ".016×.022");
  assert.equal(calibreLegible("019 x 025"), ".019×.025");
  assert.equal(calibreLegible(".016"), ".016");
  assert.equal(calibreLegible("0.014"), "0.014");
  assert.equal(calibreLegible("16"), "16");
  assert.equal(textoDeArco({ material: "NITI_SUPERELASTIC", gauge: "016" }), "NiTi superelástico .016");
});

test("un elástico nuevo en la hoja no trae medida ni fuerza de fábrica, y el servidor acepta vacío", () => {
  const raiz = join(__dirname, "..", "..", "..", "..");
  const hoja = readFileSync(join(raiz, "src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"), "utf8");
  assert.ok(!hoja.includes(`config: '1/4" 6oz'`), "el elástico nuevo sigue naciendo con 1/4\" 6oz");
  for (const accion of ["signTreatmentCard.ts", "saveTreatmentCardDraft.ts"]) {
    const src = readFileSync(join(raiz, "src/app/actions/orthodontics", accion), "utf8");
    assert.ok(!src.includes("config: z.string().min(1)"), `${accion} todavía exige medida`);
  }
});

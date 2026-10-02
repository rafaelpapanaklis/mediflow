// ws1-t12 («Invalid uuid» de BEVADENT): el importador crea cada id con el formato que declara su modelo.
// FORMATO_DE_ID (src/lib/import/migrado.ts) se contrasta aquí con el `@default(...)` de prisma/schema.prisma: si un
// modelo cambia de formato, o alguien añade uno al mapa con el formato equivocado, esta prueba falla.
// Run: npm run test:ids-de-la-base
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMATO_DE_ID, newId, type ModeloConIdPropio } from "../migrado";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const ESQUEMA = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CUID = /^c[0-9a-z]{24}$/;

/** «uuid» / «cuid» según el `@default` del id del modelo, o null si no tiene modelo o default. */
function formatoEnElEsquema(modelo: string): "uuid" | "cuid" | null {
  const m = new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m").exec(ESQUEMA);
  if (!m) return null;
  const id = m[1].split("\n").find((l) => /^\s+id\s+String\s+@id\b/.test(l));
  if (!id) return null;
  if (/@default\(uuid\(\)\)/.test(id)) return "uuid";
  if (/@default\(cuid\(\)\)/.test(id)) return "cuid";
  return null;
}

test("cada modelo del mapa tiene en el importador el mismo formato que en schema.prisma", () => {
  const distintos: string[] = [];
  for (const [modelo, formato] of Object.entries(FORMATO_DE_ID)) {
    if (modelo === "import_external_ids") continue; // tabla de SQL crudo, sin modelo (id TEXT)
    const enEsquema = formatoEnElEsquema(modelo);
    if (enEsquema !== formato) distintos.push(`${modelo}: importador ${formato}, esquema ${enEsquema}`);
  }
  assert.deepEqual(distintos, []);
});

test("los modelos de ortodoncia en los que inserta el importador son uuid", () => {
  for (const m of ["OrthodonticDiagnosis", "OrthodonticTreatmentPlan", "OrthodonticPhase", "OrthoTreatmentCard"] as const) {
    assert.equal(FORMATO_DE_ID[m], "uuid", m);
  }
});

test("newId(modelo) da el formato del modelo y no repite", () => {
  const vistos = new Set<string>();
  for (const modelo of Object.keys(FORMATO_DE_ID) as ModeloConIdPropio[]) {
    for (let i = 0; i < 50; i++) {
      const id = newId(modelo);
      assert.match(id, FORMATO_DE_ID[modelo] === "uuid" ? UUID_V4 : CUID, `${modelo}: ${id}`);
      assert.equal(vistos.has(id), false);
      vistos.add(id);
    }
  }
});

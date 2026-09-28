// ws1-t4 #86 — «Nueva consulta» no dice «no hay procedimientos» mientras carga ni manda a una ruta que no existe.
// Correr: npm run test:nueva-consulta-catalogo
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("el formulario distingue cargando / error / vacío y no muestra «vacío» mientras carga", () => {
  const f = leer("components/clinical/dental-form.tsx");
  assert.match(f, /useState<"cargando" \| "listo" \| "error">\("cargando"\)/);
  assert.match(f, /catalogEstado === "cargando"\s*\? t\("common\.loading"\)/);
  assert.match(f, /proceduresCatalogFailed/);
  assert.match(f, /\.catch\(\(\) => \{ setCatalog\(\[\]\); setCatalogEstado\("error"\); \}\)/);
});

test("el texto de catálogo vacío apunta a Administración → Procedimientos (la ruta real) en español e inglés", () => {
  for (const lang of ["es", "en"]) {
    const d = JSON.parse(leer(`i18n/dictionaries/${lang}.json`));
    const df = d.clinical.dentalForm;
    assert.ok(df.proceduresCatalogFailed, `${lang}: falta proceduresCatalogFailed`);
    assert.doesNotMatch(df.noProceduresCatalog, /Configuración → Procedimientos|Settings → Procedures/);
    assert.match(df.noProceduresCatalog, /Administra|Administration/);
  }
  const nav = leer("components/dashboard/sidebar-nav.ts");
  assert.match(nav, /id: "procedures",\s+section: "admin"/);
});

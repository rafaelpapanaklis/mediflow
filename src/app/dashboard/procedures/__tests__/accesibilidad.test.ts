/**
 * B10 de la QA en vivo de ws1-t10 (REPORTE-ws1-t10.md): los botones de icono
 * de la tabla de Procedimientos (Materiales, Editar, Activar/Desactivar,
 * Eliminar) no tenían `aria-label`, solo `title`; y el título accesible del
 * modal de Materiales salía pegado ("MaterialesQA Proc t10", sin espacio),
 * porque el nombre del procedimiento entraba como un `<span>` hijo del mismo
 * nodo de texto.
 *
 * Run: npx tsx --test src/app/dashboard/procedures/__tests__/accesibilidad.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROCEDURES = readFileSync(join(__dirname, "..", "procedures-client.tsx"), "utf8");
const MATERIALES = readFileSync(
  join(__dirname, "..", "..", "..", "..", "components", "dashboard", "inventory", "materiales-modal.tsx"),
  "utf8",
);

test("los cuatro botones de icono de la fila de Procedimientos llevan aria-label", () => {
  for (const [accion, patron] of [
    ["Materiales", /onClick=\{\(\) => setMaterialesDe\(p\)\}\s*\n\s*title="Materiales \(receta\)"\s*\n\s*aria-label=\{`Materiales \(receta\) de \$\{p\.name\}`\}/],
    ["Editar", /onClick=\{\(\) => openEdit\(p\)\}\s*\n\s*title=\{t\("common\.edit"\)\}\s*\n\s*aria-label=\{`\$\{t\("common\.edit"\)\}: \$\{p\.name\}`\}/],
    ["Activar\\/Desactivar", /onClick=\{\(\) => toggleActive\(p\)\}\s*\n\s*title=\{p\.isActive[\s\S]*?\}\s*\n\s*aria-label=\{`\$\{p\.isActive[\s\S]*?\}: \$\{p\.name\}`\}/],
    ["Eliminar", /onClick=\{\(\) => handleDelete\(p\)\}\s*\n\s*title=\{t\("common\.delete"\)\}\s*\n\s*aria-label=\{`\$\{t\("common\.delete"\)\}: \$\{p\.name\}`\}/],
  ] as const) {
    assert.match(PROCEDURES, patron as RegExp, `el botón "${accion}" no tiene aria-label junto a su title`);
  }
});

test("cerrar el modal de nuevo/editar procedimiento también tiene aria-label", () => {
  assert.match(PROCEDURES, /onClick=\{closeModal\}\s*\n\s*aria-label=\{t\("common\.close"\)\}/);
});

test("el modal de Materiales tiene un nombre accesible con espacio entre título y procedimiento", () => {
  assert.match(
    MATERIALES,
    /<Dialog\.Title className="modal__title" aria-label=\{`Materiales — \$\{procedureName\}`\}>/,
    "Dialog.Title debe declarar un aria-label explícito con separador",
  );
});

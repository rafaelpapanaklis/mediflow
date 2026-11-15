// QA B (15-nov-2026) · Barberos: dar de alta en una sede CERRADA.
//
// En panel.108, a 390 px: «Nuevo barbero» ofrecía la sucursal cerrada sin
// marcarla; al guardar, el servidor respondía 409 «Esa sede está cerrada…»,
// pero el aviso quedaba ARRIBA del formulario largo, fuera de la vista, y
// parecía que «Guardar» no hacía nada. Estática (sin navegador): el efecto de
// desplazar no corre al pintar en el servidor.
//
//   npx tsx --test src/lib/barber/__tests__/barberos-alta-error-visible.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (rel: string) => readFileSync(join(__dirname, "../../..", rel), "utf8");

test("el error de un formulario de administración se trae a la vista al aparecer", () => {
  const src = leer("components/barber/team/admin-ui.tsx");
  const bloque = src.slice(src.indexOf("export function ErrorText"), src.indexOf("export function Avatar"));
  assert.match(bloque, /useEffect\(\(\) => \{\s*if \(children\) ref\.current\?\.scrollIntoView/);
  assert.match(bloque, /ref=\{ref\}/);
  // Y sigue igual: role=alert y nada cuando no hay error.
  assert.match(bloque, /if \(!children\) return null;/);
  assert.match(bloque, /role="alert"/);
});

test("la sede cerrada sale marcada y deshabilitada, y el alta por defecto va a una abierta", () => {
  const src = leer("components/barber/team/barbers-client.tsx");
  assert.match(src, /<option key=\{b\.id\} value=\{b\.id\} disabled=\{!b\.isActive\}>/);
  assert.match(src, /b\.isActive \? b\.label : `\$\{b\.label\} \(\$\{t\("branch\.closed"\)\.toLowerCase\(\)\}\)`/);
  assert.match(src, /const openBranches = branches\.filter\(\(b\) => b\.isActive\)/);
});

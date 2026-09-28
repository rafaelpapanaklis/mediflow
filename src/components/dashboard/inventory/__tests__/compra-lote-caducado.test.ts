/**
 * N12 de la QA en vivo de ws1-t10 ronda 4 (REPORTE-ws1-t10.md): «Registrar
 * compra» aceptaba una fecha de caducidad YA pasada sin avisar — el lote
 * nacía «Caducado» de una y nadie lo notaba hasta abrir «Lotes». No se
 * bloquea, solo se avisa — mismo criterio que el resto de la ola (B1, B4…);
 * si Rafael prefiere bloquearlo, ver el reporte de ws1-t6.
 *
 * Run: npx tsx --test src/components/dashboard/inventory/__tests__/compra-lote-caducado.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEXTO = readFileSync(join(__dirname, "..", "compra-modal.tsx"), "utf8");

test("el campo Caduca de cada línea avisa si la fecha ya pasó (hoy de la clínica)", () => {
  assert.match(TEXTO, /const hoy = hoyEnZona\(timezone\);/, "compara contra el hoy de la clínica, no el del navegador");
  assert.match(TEXTO, /line\.expiresAt && line\.expiresAt < hoy/, "el aviso solo sale si la fecha capturada ya pasó");
  assert.match(TEXTO, /Ya caduc[oó]/, "el aviso dice que ya caducó");
});

test("no bloquea el registro: guardar() no valida expiresAt contra hoy", () => {
  const guardar = /async function guardar\(\) \{([\s\S]*?)\n  \}/.exec(TEXTO)?.[1] ?? "";
  assert.doesNotMatch(guardar, /expiresAt.*hoy|hoy.*expiresAt/, "guardar() no debe rechazar una caducidad pasada — solo es un aviso");
});

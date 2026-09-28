// N9 (QA ronda 4, ws1-t2) — el título del modal de Permisos mostraba la
// KEY cruda "settings.team.permissionsOf" en vez del texto («Permisos de
// {name}»): esa key vive en "settings.permissions", no en "settings.team" —
// t() cae al literal cuando no la encuentra en el diccionario.
//
// Prueba ESTÁTICA (lee el fuente y los diccionarios): este repo no renderiza
// componentes de cliente en sus tests (tsx --test + node:test, sin RTL/jsdom).
// Run: npm run test:permissions-modal-titulo

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "permissions-modal.tsx"), "utf8");
const DICCIONARIOS_DIR = join(__dirname, "..", "..", "..", "..", "i18n", "dictionaries");
const ES = JSON.parse(readFileSync(join(DICCIONARIOS_DIR, "es.json"), "utf8"));
const EN = JSON.parse(readFileSync(join(DICCIONARIOS_DIR, "en.json"), "utf8"));

function tieneClave(dic: unknown, ruta: string): boolean {
  return (
    ruta
      .split(".")
      .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dic) !==
    undefined
  );
}

test("N9: el título del modal usa una key que SÍ existe en los dos diccionarios", () => {
  const m = SRC.match(/t\((["'])(settings\.[a-zA-Z.]+)\1\s*,\s*\{\s*name:/);
  assert.ok(m, "no se encontró la llamada a t(<key>, { name: ... }) del título");
  const key = m![2];
  assert.ok(tieneClave(ES, key), `falta "${key}" en es.json`);
  assert.ok(tieneClave(EN, key), `falta "${key}" en en.json`);
});

test("N9: ya no usa la key vieja/inexistente settings.team.permissionsOf", () => {
  assert.ok(!SRC.includes("settings.team.permissionsOf"), "el modal todavía referencia la key rota");
});

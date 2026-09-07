/**
 * WS1-T3 · la pantalla /dashboard/before-after no comprobaba NINGÚN permiso.
 *
 * Run: npm run test:gate-antes-despues
 *
 * EL HALLAZGO. "Antes/Después" es una entrada real del menú lateral (sección
 * Clínico) y lo que pinta es una galería TRANSVERSAL: todos los pacientes
 * activos de la clínica y sus fotos clínicas. Respetaba la visibilidad por
 * paciente (`patientVisibilityAnd`), que es otra cosa —esconde el expediente
 * restringido, no el módulo— y ahí se acababa la puerta: entraba cualquiera con
 * sesión. Su API se cerró en la ola anterior (POST exige "xrays.upload",
 * DELETE "medicalRecord.edit"); la pantalla se quedó fuera.
 *
 * QUÉ KEY, y por qué ésta. "xrays.view" — "Ver radiografías y archivos del
 * paciente". Es la misma que exige su hermana /dashboard/xrays, que es la otra
 * galería transversal del repo y tiene exactamente esta forma. Y es el criterio
 * que ya fijó el propio módulo: POST /api/before-after pide "xrays.upload"
 * porque subir una foto de antes/después es SUBIR UN ARCHIVO del paciente; leer
 * ese mismo cajón es su espejo.
 *
 * NO se usa "medicalRecord.view" a propósito, por el mismo motivo que dejó
 * escrito el lote de estudios (estudios-permisos.test.ts): RECEPCIÓN no lo tiene
 * por default y es justo quien toma la foto — gatear con esa key le cerraría una
 * pantalla que hoy usa, sin cerrar nada que "xrays.view" no cierre ya.
 *
 * Lo que este archivo fija, en tres bloques:
 *   1 · CABLEADO — la página exige la key, y la exige ANTES de tocar la base.
 *   2 · CRITERIO — la misma key que su hermana, y la visibilidad por paciente
 *       sigue en su sitio (el gate se SUMA, no sustituye).
 *   3 · CONSECUENCIA — la matriz rol × key. Un gate que deja fuera a quien ya
 *       trabajaba es el fallo caro de endurecer permisos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasPermission, ROLE_DEFAULT_PERMISSIONS, type PermissionKey } from "../permissions";

const SRC_ROOT = join(__dirname, "..", "..", "..");            // src/
const PANTALLA = "app/dashboard/before-after/page.tsx";
const HERMANA = "app/dashboard/xrays/page.tsx";
const KEY: PermissionKey = "xrays.view";

const fileOf = (rel: string) => readFileSync(join(SRC_ROOT, ...rel.split("/")), "utf8");

type Role = keyof typeof ROLE_DEFAULT_PERMISSIONS;
const u = (role: Role, permissionsOverride: string[] = []) =>
  ({ role: role as any, permissionsOverride });

// ─────────────────────────────────────────────────────────────────────
// 1 · La pantalla exige la key, y antes de tocar la base
// ─────────────────────────────────────────────────────────────────────

test(`la pantalla Antes/Después exige "${KEY}"`, () => {
  // Con el código de hoy este archivo no menciona ningún permiso.
  const src = fileOf(PANTALLA);
  assert.match(
    src,
    /requirePermissionOrRedirect\(\s*user\s*,\s*["']xrays\.view["']\s*\)/,
    "/dashboard/before-after no comprueba ningún permiso: entra cualquiera con sesión",
  );
});

test("el gate corre ANTES de la primera consulta a la base", () => {
  // Un permiso comprobado después del findMany ya listó el padrón entero.
  const src = fileOf(PANTALLA);
  const gate = src.indexOf("requirePermissionOrRedirect(");
  const query = src.indexOf("prisma.");
  assert.notEqual(gate, -1, "no hay gate");
  assert.notEqual(query, -1, "la pantalla ya no consulta la base: revisa esta prueba");
  assert.ok(gate < query, "el gate está después de la consulta: ya leyó las filas");
});

// ─────────────────────────────────────────────────────────────────────
// 2 · El criterio: la misma puerta que su hermana, y sin perder la visibilidad
// ─────────────────────────────────────────────────────────────────────

test("es la misma key que su hermana /dashboard/xrays", () => {
  // Si alguien cambia una de las dos, esta prueba obliga a explicar por qué
  // dos galerías transversales del mismo cajón de archivos piden cosas distintas.
  assert.match(
    fileOf(HERMANA),
    /requirePermissionOrRedirect\(\s*user\s*,\s*["']xrays\.view["']\s*\)/,
    "la hermana /dashboard/xrays ya no pide xrays.view: el criterio se movió",
  );
});

test("la visibilidad por paciente sigue en su sitio", () => {
  // El permiso se SUMA al filtro que ya había; son dos guardas distintas y
  // perder la de visibilidad al añadir la de permiso sería un cambio a peor.
  assert.match(fileOf(PANTALLA), /patientVisibilityAnd\(/);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · Consecuencia: a quién cierra y a quién NO
// ─────────────────────────────────────────────────────────────────────

const DEJAN_TRABAJAR: Role[] = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST"];

for (const rol of DEJAN_TRABAJAR) {
  test(`${rol} sigue entrando a Antes/Después (tiene "${KEY}" por default)`, () => {
    assert.ok(
      hasPermission(u(rol), KEY),
      `${rol} se quedaría fuera de una pantalla que hoy usa`,
    );
  });
}

test(`READONLY queda fuera: el default del rol le niega todo "xrays.*"`, () => {
  // Es el hallazgo: no ve la pestaña Radiografías y sin embargo abría esta
  // galería con las fotos clínicas de todos los pacientes activos.
  assert.equal(hasPermission(u("READONLY"), KEY), false);
  assert.ok(
    !ROLE_DEFAULT_PERMISSIONS.READONLY.some((k) => k.startsWith("xrays.")),
    "READONLY dejó de estar excluido de xrays.*: revisa este gate",
  );
});

test("una clínica que apaga 'Ver radiografías' cierra también esta pantalla", () => {
  // El caso concreto del hallazgo: el interruptor existía y esta puerta no lo
  // escuchaba. `permissionsOverride` sin la key = permiso retirado a mano.
  const recepcionSinPlacas = u("RECEPTIONIST", ["today.view", "patients.view"]);
  assert.equal(hasPermission(recepcionSinPlacas, KEY), false);
});

test("y si se la conceden a mano, entra aunque el rol no la traiga", () => {
  const readonlyConPlacas = u("READONLY", ["xrays.view"]);
  assert.equal(hasPermission(readonlyConPlacas, KEY), true);
});

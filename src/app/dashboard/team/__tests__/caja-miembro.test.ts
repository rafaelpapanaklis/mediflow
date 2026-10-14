/**
 * Equipo → ficha → «Caja» (ws1-t1): las reglas de pantalla y el cableado.
 *
 * `npm run test:caja-pin-equipo`
 *
 * El servidor repite cada regla (ver src/app/api/team/__tests__/caja-pin-equipo.test.ts);
 * aquí se vigila lo que decide la pantalla.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cajaQueViaja, estadoPinDeCaja, motivoCajaFija, seccionCajaVisible } from "../caja-miembro";
import { TEXTOS_EQUIPO } from "../textos-equipo";

const AQUI = join(__dirname, "..");
const leer = (f: string) => readFileSync(join(AQUI, f), "utf8");

test("la sección «Caja» solo se enseña con «Editar equipo»", () => {
  assert.equal(seccionCajaVisible({ puedeEditarEquipo: true }), true);
  assert.equal(seccionCajaVisible({ puedeEditarEquipo: false }), false);
});

test("SUPER_ADMIN: casilla fija («Siempre, por ser Super Admin»)", () => {
  const m = motivoCajaFija({ rolDelMiembro: "SUPER_ADMIN", esYo: false, actorEsDueno: true, puedeEditarEquipo: true });
  assert.equal(m, "super-admin");
  assert.equal(TEXTOS_EQUIPO.es.cajaSiempreSuper, "Siempre, por ser Super Admin");
});

test("un ADMIN no mueve su propia casilla; el dueño y los demás sí", () => {
  const base = { rolDelMiembro: "ADMIN", puedeEditarEquipo: true };
  assert.equal(motivoCajaFija({ ...base, esYo: true, actorEsDueno: false }), "yo");
  assert.equal(motivoCajaFija({ ...base, esYo: false, actorEsDueno: false }), null);
  assert.equal(motivoCajaFija({ rolDelMiembro: "RECEPTIONIST", esYo: false, actorEsDueno: true, puedeEditarEquipo: true }), null);
});

test("la casilla solo viaja si la persona la cambió", () => {
  assert.equal(cajaQueViaja({ inicial: false, actual: true, fija: null }), true);
  assert.equal(cajaQueViaja({ inicial: true, actual: false, fija: null }), false);
  assert.equal(cajaQueViaja({ inicial: true, actual: true, fija: null }), undefined);
  assert.equal(cajaQueViaja({ inicial: false, actual: false, fija: null }), undefined);
});

test("una casilla fija nunca viaja, aunque el estado diga otra cosa", () => {
  assert.equal(cajaQueViaja({ inicial: false, actual: true, fija: "super-admin" }), undefined);
  assert.equal(cajaQueViaja({ inicial: false, actual: true, fija: "yo" }), undefined);
});

test("el estado del PIN: creado / sin crear (nada más que el booleano)", () => {
  assert.equal(estadoPinDeCaja(true), "creado");
  assert.equal(estadoPinDeCaja(false), "sin-crear");
  assert.equal(estadoPinDeCaja(undefined), "sin-crear");
});

test("es y en dicen lo mismo: mismas claves, nada vacío", () => {
  const es = Object.keys(TEXTOS_EQUIPO.es).sort();
  const en = Object.keys(TEXTOS_EQUIPO.en).sort();
  assert.deepEqual(es, en);
  assert.equal(TEXTOS_EQUIPO.es.restablecerPinBtn, "Restablecer PIN de Caja");
  assert.equal(TEXTOS_EQUIPO.es.cajaPuedeUsar, "Puede usar Caja");
});

test("cableado: team-client manda canAccessCaja a /api/team (PATCH y alta)", () => {
  const c = leer("team-client.tsx");
  assert.match(c, /canAccessCaja:\s*cajaNueva/, "el PATCH no manda canAccessCaja");
  assert.match(c, /canAccessCaja:\s*cajaAcceso/, "el alta no manda canAccessCaja");
  assert.match(c, /\/api\/team\/\$\{m\.id\}\/caja-pin/, "no llama al endpoint de restablecer");
  // «Restablecer» solo se ofrece al dueño y pide confirmación en pantalla.
  assert.match(c, /onRestablecerPin:\s*isSuperAdmin/);
  assert.match(c, /async function restablecerPinDeCaja[\s\S]*?askConfirm\(/);
});

test("cableado: la página deriva el booleano y el hash no viaja al navegador", () => {
  const p = leer("page.tsx");
  assert.match(p, /cajaPinHash:\s*true/);
  assert.match(p, /conIndicadorDePin\(m\)/, "la fila llega al cliente sin pasar por conIndicadorDePin");
  assert.match(p, /puedeEditarEquipo=\{hasPermission\(/);
});

test("cableado: el rediseño y la pantalla clásica comparten la misma ficha", () => {
  // Un solo MemberForm: con `rediseno` solo cambia la raíz (RaizRediseno).
  const c = leer("team-client.tsx");
  assert.equal((c.match(/<MemberForm/g) ?? []).length, 2, "alta + edición");
  assert.equal((c.match(/caja=\{seccionCajaVisible/g) ?? []).length, 2, "la sección Caja va en las dos");
});

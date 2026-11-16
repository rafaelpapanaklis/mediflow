// La matriz de permisos de Equipo, pintada de verdad (react-dom/server), sin base.
//
// D4 (auditoría de permisos, 16-nov): lo que viene INCLUIDO en otro permiso
// encendido sale encendido y BLOQUEADO con «Viene con «…»». Antes se podía
// apagar y al guardar el servidor lo volvía a sumar: parecía que quitarlo no
// servía.
//
//   npx tsx --test src/lib/barber/__tests__/matriz-permisos-pantalla.test.ts
import "@/components/admin/portada/__tests__/_react-global";
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// CSS modules: cada clase se llama como su llave (así se puede buscar en el HTML).
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const original = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  // describeMemberPermissions vive en team.ts (servidor); aquí solo se usa su parte pura.
  if (request === "server-only") return {};
  if (request.endsWith(".module.css")) {
    const proxy = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : String(k)) });
    return { __esModule: true, default: proxy };
  }
  return original.call(this, request, parent, isMain);
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { PermissionMatrix } = require("@/components/barber/team/permission-matrix") as typeof import("@/components/barber/team/permission-matrix");
const { AdminI18n } = require("@/components/barber/team/admin-ui") as typeof import("@/components/barber/team/admin-ui");
const { describeMemberPermissions } = require("@/lib/barber/team") as typeof import("@/lib/barber/team");
const { getBarberDict } = require("@/i18n/dictionaries/barber") as typeof import("@/i18n/dictionaries/barber");
const { includedBy, BARBER_PERMISSION_KEYS } = require("@/lib/barber/permissions") as typeof import("@/lib/barber/permissions");
/* eslint-enable @typescript-eslint/no-require-imports */

type Rol = "OWNER" | "MANAGER" | "RECEPTION" | "BARBER";

function pinta(role: Rol, override: string[] = []) {
  const member = {
    id: "u1",
    firstName: "Rita",
    lastName: "Prueba",
    role,
    isSelf: false,
    permissions: describeMemberPermissions(role, override),
  };
  return renderToStaticMarkup(
    createElement(AdminI18n, {
      dict: getBarberDict("es"),
      children: createElement(PermissionMatrix, {
        member: member as never,
        roleLabel: "Recepción",
        advancedRoles: true,
        planName: "Profesional",
        ownPermissions: [...BARBER_PERMISSION_KEYS],
        onClose: () => undefined,
        onSaved: () => undefined,
      }),
    }),
  );
}

/** El interruptor (botón role=switch) de una etiqueta, con sus atributos. */
function interruptor(html: string, etiqueta: string): string {
  const m = html.match(new RegExp(`<button[^>]*role="switch"[^>]*aria-label="${etiqueta}"[^>]*>`))
    ?? html.match(new RegExp(`<button[^>]*aria-label="${etiqueta}"[^>]*role="switch"[^>]*>`));
  assert.ok(m, `no está el interruptor «${etiqueta}»`);
  return m[0];
}
/** El renglón entero de una etiqueta (texto hasta su interruptor). */
function renglon(html: string, etiqueta: string): string {
  const i = html.indexOf(`>${etiqueta}<`);
  assert.ok(i >= 0, `no está el renglón «${etiqueta}»`);
  return html.slice(i, html.indexOf(`aria-label="${etiqueta}"`, i) + 200);
}

test("includedBy: de qué permiso encendido viene cada incluido", () => {
  assert.deepEqual([...includedBy(["products.manage"])], [["products.view", "products.manage"]]);
  assert.equal(includedBy(["timeoff.manage"]).get("timeoff.own"), "timeoff.manage");
  assert.equal(includedBy(["schedule.manage", "timeoff.manage"]).get("timeoff.own"), "schedule.manage");
  assert.equal(includedBy(["commissions.manage"]).get("commissions.view"), "commissions.manage");
  assert.equal(includedBy(["products.view"]).size, 0, "ver no incluye administrar");
});

test("D4 · Recepción: «sus propios bloqueos» sale bloqueado y dice de dónde viene", () => {
  const html = pinta("RECEPTION");
  const sw = interruptor(html, "Poner y quitar sus propios bloqueos");
  assert.match(sw, /aria-checked="true"/);
  assert.match(sw, / disabled=""/, "no se puede apagar suelto");
  assert.match(renglon(html, "Poner y quitar sus propios bloqueos"), /Viene con «Poner y quitar bloqueos de cualquiera»/);
  // El que lo incluye sí se puede tocar.
  assert.doesNotMatch(interruptor(html, "Poner y quitar bloqueos de cualquiera"), / disabled=""/);
  // Un permiso normal, tampoco bloqueado.
  assert.doesNotMatch(interruptor(html, "Cobrar y hacer cortes"), / disabled=""/);
});

test("D4 · «Administrar productos» bloquea «Ver productos»; sin él, «Ver productos» se apaga normal", () => {
  const efectivo = [...describeMemberPermissions("RECEPTION", []).effective, "products.manage"];
  const con = pinta("RECEPTION", efectivo);
  assert.match(interruptor(con, "Ver productos y existencias"), / disabled=""/);
  assert.match(renglon(con, "Ver productos y existencias"), /Viene con «Administrar productos \(catálogo, precio y costo\)»/);
  const sin = pinta("RECEPTION");
  assert.doesNotMatch(interruptor(sin, "Ver productos y existencias"), / disabled=""/);
  assert.doesNotMatch(renglon(sin, "Ver productos y existencias"), /Viene con/);
});

test("D4 · Barbero de fábrica: nada bloqueado por incluido (no trae ningún «administrar»)", () => {
  const html = pinta("BARBER");
  assert.doesNotMatch(html, /Viene con/);
});

// Matriz de permisos del permiso que exigen las 4 escrituras del bot de
// WhatsApp — hallazgo M-13 de la auditoría.
//
// Antes, cualquier usuario con sesión podía encender el bot y reescribir lo que
// le dice a los pacientes desde el número oficial de la clínica. El fix exige
// "whatsapp.send" en PATCH /api/whatsapp/bot y en las 3 rutas de FAQs.
//
// Lo que protege este test: que endurecer esas rutas NO deje fuera a quien de
// verdad opera el bot en una clínica (recepción), y que quien no debe tocarlo
// siga sin poder.
//
// Patrón node:test + tsx. Correr: npm run test:wa-permissions

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, getEffectivePermissions, ROLE_DEFAULT_PERMISSIONS } from "../permissions";

/** Clave exacta que exigen bot/route.ts y las 3 rutas de bot/faqs/. */
const WRITE = "whatsapp.send" as const;
/** Clave que exigen las páginas /dashboard/whatsapp y /dashboard/whatsapp/bot. */
const VIEW = "whatsapp.view" as const;

const user = (role: keyof typeof ROLE_DEFAULT_PERMISSIONS, override?: string[]) =>
  ({ role, permissionsOverride: override ?? [] }) as Parameters<typeof getEffectivePermissions>[0];

describe("quién puede CONFIGURAR el bot (whatsapp.send)", () => {
  it("recepción SÍ puede: es quien opera el bot en una clínica real", () => {
    // Si esto se pusiera en false, el fix M-13 rompería a usuarios legítimos y
    // no se podría mergear.
    assert.equal(hasPermission(user("RECEPTIONIST"), WRITE), true);
  });

  it("ADMIN y SUPER_ADMIN también", () => {
    assert.equal(hasPermission(user("ADMIN"), WRITE), true);
    assert.equal(hasPermission(user("SUPER_ADMIN"), WRITE), true);
  });

  it("DOCTOR no: era exactamente el rol del hallazgo (creable desde el producto)", () => {
    assert.equal(hasPermission(user("DOCTOR"), WRITE), false);
  });

  it("READONLY no puede escribir, pero sí ver", () => {
    assert.equal(hasPermission(user("READONLY"), WRITE), false);
    assert.equal(hasPermission(user("READONLY"), VIEW), true);
  });

  it("los 5 roles del producto están cubiertos por la matriz", () => {
    // Si mañana se agrega un rol, este test obliga a decidir su acceso al bot
    // en vez de heredarlo por accidente.
    assert.deepEqual(Object.keys(ROLE_DEFAULT_PERMISSIONS).sort(), [
      "ADMIN",
      "DOCTOR",
      "READONLY",
      "RECEPTIONIST",
      "SUPER_ADMIN",
    ]);
  });
});

describe("quién puede VER la pantalla de WhatsApp (whatsapp.view)", () => {
  // El panel de "Últimos recordatorios" muestra nombres de pacientes, así que
  // /dashboard/whatsapp exige este permiso igual que sus hijas.
  it("la ve recepción, ADMIN, SUPER_ADMIN y READONLY", () => {
    for (const role of ["RECEPTIONIST", "ADMIN", "SUPER_ADMIN", "READONLY"] as const) {
      assert.equal(hasPermission(user(role), VIEW), true, role);
    }
  });

  it("DOCTOR no la ve (no la tiene por default)", () => {
    assert.equal(hasPermission(user("DOCTOR"), VIEW), false);
  });

  it("quien puede escribir siempre puede ver (no hay rol que escriba a ciegas)", () => {
    for (const role of Object.keys(ROLE_DEFAULT_PERMISSIONS) as (keyof typeof ROLE_DEFAULT_PERMISSIONS)[]) {
      if (hasPermission(user(role), WRITE)) {
        assert.equal(hasPermission(user(role), VIEW), true, role);
      }
    }
  });
});

describe("permisos personalizados (permissionsOverride)", () => {
  it("el override REEMPLAZA al default: un ADMIN sin la key pierde la escritura", () => {
    // Consecuencia consciente del fix: a un ADMIN al que el dueño le
    // personalizó permisos y dejó "Enviar WhatsApp" desmarcado, el PATCH del
    // bot le responde 403 donde antes pasaba.
    const acotado = user("ADMIN", ["today.view", "agenda.view", VIEW]);
    assert.equal(hasPermission(acotado, WRITE), false);
    assert.equal(hasPermission(acotado, VIEW), true);
  });

  it("un DOCTOR con la key marcada a mano SÍ puede configurar el bot", () => {
    assert.equal(hasPermission(user("DOCTOR", [VIEW, WRITE]), WRITE), true);
  });

  it("un override vacío cae al default del rol", () => {
    assert.deepEqual(
      getEffectivePermissions(user("RECEPTIONIST", [])),
      ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST,
    );
    assert.deepEqual(
      getEffectivePermissions({ role: "RECEPTIONIST", permissionsOverride: null }),
      ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST,
    );
  });

  it("las keys inventadas en el override se descartan", () => {
    assert.equal(hasPermission(user("ADMIN", ["whatsapp.config"]), WRITE), false);
    assert.deepEqual(getEffectivePermissions(user("ADMIN", ["whatsapp.config"])), []);
  });
});

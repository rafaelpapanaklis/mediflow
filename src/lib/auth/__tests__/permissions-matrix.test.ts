/**
 * Matriz rol × permiso de agenda/pacientes (Ola 2 · P1-3).
 *
 * Run: npm run test:permissions
 *
 * Estos tests son el candado de la regla "no dejes fuera a nadie que hoy
 * trabaja": al empezar a EXIGIR agenda.create/edit/delete y
 * patients.create/edit en las rutas, los defaults por rol deben cubrir lo
 * que cada rol ya hacía. Si alguien recorta un default aquí se entera antes
 * de que un RECEPTIONIST se quede sin poder crear pacientes en producción.
 *
 * También fija la semántica del override (getEffectivePermissions):
 *  - override VACÍO  → defaults del rol (nunca "denegado todo").
 *  - override LLENO  → REEMPLAZA los defaults (destildar una key la niega).
 *  - keys inválidas en el override se descartan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PERMISSION_KEYS,
  ROLE_DEFAULT_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  type PermissionKey,
} from "../permissions";

type Role = keyof typeof ROLE_DEFAULT_PERMISSIONS;

const ENFORCED_KEYS: PermissionKey[] = [
  "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
  "patients.view", "patients.create", "patients.edit", "patients.delete",
  "medicalRecord.view", "medicalRecord.edit",
];

/** Lo que cada rol DEBE poder hacer por default (true) o no (false). */
const EXPECTED: Record<Role, Record<string, boolean>> = {
  SUPER_ADMIN: Object.fromEntries(ENFORCED_KEYS.map((k) => [k, true])),
  ADMIN:       Object.fromEntries(ENFORCED_KEYS.map((k) => [k, true])),
  DOCTOR: {
    "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.delete": true,
    "patients.view": true, "patients.create": true, "patients.edit": true,
    // Archivar/eliminar pacientes es admin-only por default (ya se aplicaba así).
    "patients.delete": false,
    "medicalRecord.view": true, "medicalRecord.edit": true,
  },
  RECEPTIONIST: {
    "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.delete": true,
    "patients.view": true, "patients.create": true, "patients.edit": true,
    "patients.delete": false,
    // Recepción no ve expediente clínico (igual que la capa legacy que había).
    "medicalRecord.view": false, "medicalRecord.edit": false,
  },
  READONLY: {
    "agenda.view": true, "agenda.create": false, "agenda.edit": false, "agenda.delete": false,
    "patients.view": true, "patients.create": false, "patients.edit": false,
    "patients.delete": false,
    "medicalRecord.view": false, "medicalRecord.edit": false,
  },
};

test("matriz por default: cada rol conserva lo que hoy hace y pierde lo que nunca debió tener", () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    for (const key of ENFORCED_KEYS) {
      const got = hasPermission({ role: role as any, permissionsOverride: [] }, key);
      assert.equal(
        got,
        EXPECTED[role][key],
        `${role} × ${key}: esperaba ${EXPECTED[role][key]}, hasPermission dio ${got}`,
      );
    }
  }
});

test("override vacío o ausente cae a los defaults del rol (nunca deniega todo)", () => {
  const conVacio = getEffectivePermissions({ role: "RECEPTIONIST" as any, permissionsOverride: [] });
  const conNull = getEffectivePermissions({ role: "RECEPTIONIST" as any, permissionsOverride: null });
  assert.deepEqual(conVacio, ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST);
  assert.deepEqual(conNull, ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST);
});

test("override lleno REEMPLAZA: destildar 'Crear pacientes' de verdad lo niega", () => {
  const sinCrear = (ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST as string[]).filter(
    (k) => k !== "patients.create",
  );
  const user = { role: "RECEPTIONIST" as any, permissionsOverride: sinCrear };
  assert.equal(hasPermission(user, "patients.create"), false);
  // …y lo que sí quedó tildado sigue funcionando.
  assert.equal(hasPermission(user, "agenda.create"), true);
  assert.equal(hasPermission(user, "patients.edit"), true);
});

test("keys inválidas en el override se descartan sin romper las válidas", () => {
  const user = {
    role: "DOCTOR" as any,
    permissionsOverride: ["agenda.create", "clave.inventada", "patients.edit"],
  };
  const effective = getEffectivePermissions(user);
  assert.deepEqual(effective.sort(), ["agenda.create", "patients.edit"].sort());
});

test("los defaults solo contienen keys del catálogo (sin typos)", () => {
  const catalog = new Set<string>(ALL_PERMISSION_KEYS);
  for (const [role, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    for (const k of keys) {
      assert.ok(catalog.has(k), `default de ${role} contiene key fuera de catálogo: ${k}`);
    }
  }
});

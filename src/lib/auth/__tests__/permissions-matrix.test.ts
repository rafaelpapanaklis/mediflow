/**
 * Matriz rol × permiso del panel (Ola 2 · P1-3, ampliada en ISO-03 / EQ-07).
 *
 * Run: npm run test:permissions
 *
 * Estos tests son el candado de la regla "no dejes fuera a nadie que hoy
 * trabaja": cada vez que una key del catálogo EMPIEZA A EXIGIRSE en una ruta,
 * los defaults por rol tienen que cubrir lo que cada rol ya hacía. Si alguien
 * recorta un default aquí se entera antes de que un RECEPTIONIST se quede sin
 * poder subir una placa en producción.
 *
 * También fija:
 *  - la semántica del override (getEffectivePermissions): VACÍO → defaults del
 *    rol; LLENO → REEMPLAZA (destildar una key la niega); keys inválidas fuera.
 *  - ISO-03: la capa legacy por rol (`hasPermission(role, "entidad.acción")`)
 *    ya no existe, y las keys modernas a las que se migraron sus 14 llamadas
 *    dan por default EXACTAMENTE los mismos roles que daba la tabla legacy.
 *  - EQ-07: ninguna key del catálogo se queda sin lector. El test recorre
 *    src/ y falla si un interruptor vuelve a quedarse muerto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  ALL_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  sanitizePermissionKeys,
  type PermissionKey,
} from "../permissions";

type Role = keyof typeof ROLE_DEFAULT_PERMISSIONS;
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"];

const u = (role: Role, permissionsOverride: string[] = []) =>
  ({ role: role as any, permissionsOverride });

// ─────────────────────────────────────────────────────────────────────
// 1 · La matriz por default de TODO lo que el servidor exige hoy
// ─────────────────────────────────────────────────────────────────────

/**
 * Keys que un endpoint o una página exigen de verdad (denyIfMissingPermission /
 * requirePermissionOrRedirect / hasPermission en server). Las que faltan del
 * catálogo (today.view, inventory.view, suppliers.view, clinicLayout.view,
 * marketplace.view, specialties.*) solo las lee el sidebar — se listan en el
 * test de "ningún interruptor muerto", no aquí.
 */
const ENFORCED_KEYS: PermissionKey[] = [
  "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
  "patients.view", "patients.create", "patients.edit", "patients.delete",
  "medicalRecord.view", "medicalRecord.edit",
  "prescription.view", "prescription.create",
  "consents.view", "consents.create", "consents.revoke",
  "xrays.view", "xrays.upload", "xrays.analyze",
  "treatments.view", "treatments.edit",
  "inbox.view", "inbox.send", "inbox.delete",
  "whatsapp.view", "whatsapp.send",
  "resources.view", "resources.edit",
  "inventory.edit",
  "suppliers.order",
  "billing.view", "billing.create", "billing.charge", "billing.refund", "billing.edit",
  "analytics.view", "reports.view",
  "tvModes.view", "tvModes.edit",
  "team.view", "team.edit",
  "settings.view", "settings.edit",
  "landing.view", "landing.edit",
  "procedures.view", "procedures.edit",
  "clinicLayout.edit",
  "arco.manage",
];

/** Lo que cada rol DEBE poder hacer por default (true) o no (false). */
const EXPECTED: Record<Role, Record<string, boolean>> = {
  SUPER_ADMIN: Object.fromEntries(ENFORCED_KEYS.map((k) => [k, true])),
  // EQ-07: ADMIN también tiene team.edit — POST/PATCH/DELETE /api/team ya lo
  // dejaban pasar por rol; el default lo excluía por una etiqueta falsa.
  ADMIN:       Object.fromEntries(ENFORCED_KEYS.map((k) => [k, true])),
  DOCTOR: {
    "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.delete": true,
    "patients.view": true, "patients.create": true, "patients.edit": true,
    // Archivar/eliminar pacientes es admin-only por default (ya se aplicaba así).
    "patients.delete": false,
    "medicalRecord.view": true, "medicalRecord.edit": true,
    "prescription.view": true, "prescription.create": true,
    "consents.view": true, "consents.create": true, "consents.revoke": true,
    "xrays.view": true, "xrays.upload": true, "xrays.analyze": true,
    // El doctor es el autor natural del plan de tratamiento (EQ-07).
    "treatments.view": true, "treatments.edit": true,
    "inbox.view": true, "inbox.send": true, "inbox.delete": false,
    "whatsapp.view": false, "whatsapp.send": false,
    "resources.view": true, "resources.edit": false,
    "inventory.edit": false,
    "suppliers.order": false,
    "billing.view": false, "billing.create": false, "billing.charge": false, "billing.refund": false, "billing.edit": false,
    "analytics.view": false, "reports.view": false,
    "tvModes.view": false, "tvModes.edit": false,
    "team.view": false, "team.edit": false,
    "settings.view": false, "settings.edit": false,
    "landing.view": false, "landing.edit": false,
    "procedures.view": false, "procedures.edit": false,
    "clinicLayout.edit": false,
    "arco.manage": false,
  },
  RECEPTIONIST: {
    "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.delete": true,
    "patients.view": true, "patients.create": true, "patients.edit": true,
    "patients.delete": false,
    // Recepción no ve expediente clínico (igual que la capa legacy que había).
    "medicalRecord.view": false, "medicalRecord.edit": false,
    "prescription.view": false, "prescription.create": false,
    "consents.view": true, "consents.create": true, "consents.revoke": false,
    // EQ-07: sube la placa y los archivos del paciente desde la ficha; NO la
    // interpreta con IA (clínico y cobra tokens).
    "xrays.view": true, "xrays.upload": true, "xrays.analyze": false,
    // EQ-07: arma presupuestos y registra sesiones.
    "treatments.view": true, "treatments.edit": true,
    "inbox.view": true, "inbox.send": true, "inbox.delete": false,
    "whatsapp.view": true, "whatsapp.send": true,
    "resources.view": true, "resources.edit": false,
    "inventory.edit": false,
    "suppliers.order": false,
    "billing.view": true, "billing.create": true, "billing.charge": true, "billing.refund": false, "billing.edit": true,
    "analytics.view": false, "reports.view": false,
    "tvModes.view": false, "tvModes.edit": false,
    "team.view": false, "team.edit": false,
    "settings.view": false, "settings.edit": false,
    "landing.view": false, "landing.edit": false,
    "procedures.view": false, "procedures.edit": false,
    "clinicLayout.edit": false,
    "arco.manage": false,
  },
  READONLY: {
    "agenda.view": true, "agenda.create": false, "agenda.edit": false, "agenda.delete": false,
    "patients.view": true, "patients.create": false, "patients.edit": false,
    "patients.delete": false,
    "medicalRecord.view": false, "medicalRecord.edit": false,
    "prescription.view": false, "prescription.create": false,
    "consents.view": false, "consents.create": false, "consents.revoke": false,
    // Solo lectura no ve documentos clínicos: expediente, recetas,
    // consentimientos ni placas.
    "xrays.view": false, "xrays.upload": false, "xrays.analyze": false,
    "treatments.view": true, "treatments.edit": false,
    "inbox.view": true, "inbox.send": false, "inbox.delete": false,
    "whatsapp.view": true, "whatsapp.send": false,
    "resources.view": true, "resources.edit": false,
    "inventory.edit": false,
    "suppliers.order": false,
    "billing.view": true, "billing.create": false, "billing.charge": false, "billing.refund": false, "billing.edit": false,
    "analytics.view": true, "reports.view": true,
    "tvModes.view": true, "tvModes.edit": false,
    "team.view": true, "team.edit": false,
    "settings.view": true, "settings.edit": false,
    "landing.view": true, "landing.edit": false,
    "procedures.view": true, "procedures.edit": false,
    "clinicLayout.edit": false,
    // A propósito no acaba en ".view": solicitudes de datos personales de terceros.
    "arco.manage": false,
  },
};

test("matriz por default: cada rol conserva lo que hoy hace y pierde lo que nunca debió tener", () => {
  for (const role of ROLES) {
    for (const key of ENFORCED_KEYS) {
      assert.ok(key in EXPECTED[role], `falta la expectativa de ${role} × ${key}`);
      const got = hasPermission(u(role), key);
      assert.equal(
        got,
        EXPECTED[role][key],
        `${role} × ${key}: esperaba ${EXPECTED[role][key]}, hasPermission dio ${got}`,
      );
    }
  }
});

test("la matriz esperada no se queda corta: cubre TODAS las keys exigidas", () => {
  for (const role of ROLES) {
    const faltan = ENFORCED_KEYS.filter((k) => !(k in EXPECTED[role]));
    assert.deepEqual(faltan, [], `${role}: sin expectativa para ${faltan.join(", ")}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 2 · Semántica del override
// ─────────────────────────────────────────────────────────────────────

test("override vacío o ausente cae a los defaults del rol (nunca deniega todo)", () => {
  const conVacio = getEffectivePermissions(u("RECEPTIONIST", []));
  const conNull = getEffectivePermissions({ role: "RECEPTIONIST" as any, permissionsOverride: null });
  assert.deepEqual(conVacio, ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST);
  assert.deepEqual(conNull, ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST);
});

test("override lleno REEMPLAZA: destildar 'Crear pacientes' de verdad lo niega", () => {
  const sinCrear = (ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST as string[]).filter(
    (k) => k !== "patients.create",
  );
  const user = u("RECEPTIONIST", sinCrear);
  assert.equal(hasPermission(user, "patients.create"), false);
  // …y lo que sí quedó tildado sigue funcionando.
  assert.equal(hasPermission(user, "agenda.create"), true);
  assert.equal(hasPermission(user, "patients.edit"), true);
});

test("ISO-03: apagarle 'Crear/firmar recetas' a un doctor AHORA se lo quita (antes la capa por rol lo ignoraba)", () => {
  const sinRecetas = (ROLE_DEFAULT_PERMISSIONS.DOCTOR as string[]).filter(
    (k) => k !== "prescription.create" && k !== "medicalRecord.edit",
  );
  const doctor = u("DOCTOR", sinRecetas);
  assert.equal(hasPermission(doctor, "prescription.create"), false, "POST /api/prescriptions debe dar 403");
  assert.equal(hasPermission(doctor, "medicalRecord.edit"), false, "DELETE de nota SOAP / placa debe dar 403");
  // Y lo que no se tocó, sigue.
  assert.equal(hasPermission(doctor, "prescription.view"), true);
  assert.equal(hasPermission(doctor, "medicalRecord.view"), true);
});

test("el interruptor también CONCEDE: recepción con 'Editar notas SOAP' encendido pasa la puerta", () => {
  // El endpoint puede seguir acotando (dueño-o-admin), pero el permiso ya no
  // se decide por el rol pelado.
  const recepcion = u("RECEPTIONIST", [...ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST, "medicalRecord.edit"]);
  assert.equal(hasPermission(recepcion, "medicalRecord.edit"), true);
});

test("keys inválidas en el override se descartan sin romper las válidas", () => {
  const user = {
    role: "DOCTOR" as any,
    permissionsOverride: ["agenda.create", "clave.inventada", "patients.edit"],
  };
  const effective = getEffectivePermissions(user);
  assert.deepEqual(effective.sort(), ["agenda.create", "patients.edit"].sort());
});

test("las keys legacy (arco.read, prescription.delete, medicalRecord.create…) NO pueden vivir en un override", () => {
  // Si sanitize las dejara pasar, un override con ellas parecería conceder
  // algo que ninguna ruta lee.
  const legacy = ["arco.read", "arco.update", "prescription.read", "prescription.delete",
    "medicalRecord.read", "medicalRecord.create", "medicalRecord.update", "medicalRecord.delete", "*"];
  assert.deepEqual(sanitizePermissionKeys(legacy), []);
  assert.deepEqual(sanitizePermissionKeys([...legacy, "arco.manage"]), ["arco.manage"]);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · ISO-03 — la capa legacy por rol ya no existe y la migración no
//     cambió a nadie por default
// ─────────────────────────────────────────────────────────────────────

test("ISO-03: hasPermission ya no acepta un rol suelto — un string se niega, no se adivina", () => {
  // Tipos: pasar un string ya no compila (la firma pide el usuario). Runtime:
  // por si llega casteado (`ctx.role as any`), niega en vez de caer al default.
  // @ts-expect-error — la sobrecarga legacy `hasPermission(role, key)` se retiró
  assert.equal(hasPermission("DOCTOR", "patients.view"), false);
  // @ts-expect-error — ídem con SUPER_ADMIN: sin usuario no hay override que consultar
  assert.equal(hasPermission("SUPER_ADMIN", "patients.view"), false);
});

/**
 * Lo que daba la tabla legacy ROLE_PERMISSIONS (retirada) para las entidades
 * de las 14 llamadas migradas, y la key moderna a la que fue cada una:
 *
 *   medicalRecord.{read,create,update,delete} → SA/ADMIN/DOCTOR
 *   prescription.{read,create,delete}         → SA/ADMIN/DOCTOR
 *   arco.{read,update}                        → SA/ADMIN
 *
 * Si alguien recorta o amplía el default de una key moderna, este test avisa
 * de que la migración dejó de ser neutra.
 */
const ISO03_MAPPING: Array<{ legacy: string; modern: PermissionKey; legacyRoles: Role[] }> = [
  { legacy: "medicalRecord.read   (GET export-cda)",                          modern: "medicalRecord.view", legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "medicalRecord.create (POST ai-assist)",                          modern: "medicalRecord.edit", legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "medicalRecord.update (PATCH ai-assist)",                         modern: "medicalRecord.edit", legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "medicalRecord.delete (DELETE nota SOAP / placa / modelo 3D)",    modern: "medicalRecord.edit", legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "prescription.read   (GET recetas / pdf / POST send)",            modern: "prescription.view",  legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "prescription.create (POST recetas / check-contraindications)",   modern: "prescription.create", legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "prescription.delete (DELETE receta = anular)",                   modern: "prescription.create", legacyRoles: ["SUPER_ADMIN", "ADMIN", "DOCTOR"] },
  { legacy: "arco.read           (GET /api/arco/[id])",                       modern: "arco.manage",        legacyRoles: ["SUPER_ADMIN", "ADMIN"] },
  { legacy: "arco.update         (PATCH /api/arco/[id])",                     modern: "arco.manage",        legacyRoles: ["SUPER_ADMIN", "ADMIN"] },
];

test("ISO-03: cada key moderna da por default EXACTAMENTE los roles que daba la legacy (nadie gana, nadie pierde)", () => {
  for (const m of ISO03_MAPPING) {
    const modernRoles = ROLES.filter((r) => hasPermission(u(r), m.modern));
    assert.deepEqual(
      modernRoles,
      m.legacyRoles,
      `${m.legacy} → ${m.modern}: legacy ${m.legacyRoles.join("/")}, moderna ${modernRoles.join("/")}`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// 4 · Salud del catálogo
// ─────────────────────────────────────────────────────────────────────

test("los defaults solo contienen keys del catálogo (sin typos)", () => {
  const catalog = new Set<string>(ALL_PERMISSION_KEYS);
  for (const [role, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    for (const k of keys) {
      assert.ok(catalog.has(k), `default de ${role} contiene key fuera de catálogo: ${k}`);
    }
  }
});

test("cada key del catálogo está en EXACTAMENTE un grupo del modal (si no, no se puede encender ni apagar)", () => {
  const seen = new Map<string, number>();
  for (const g of PERMISSION_GROUPS) for (const k of g.keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const k of ALL_PERMISSION_KEYS) {
    assert.equal(seen.get(k) ?? 0, 1, `${k} aparece ${seen.get(k) ?? 0} veces en PERMISSION_GROUPS`);
  }
  for (const [k, n] of Array.from(seen.entries())) {
    assert.ok(k in ALL_PERMISSIONS, `grupo con key fuera de catálogo: ${k} (${n})`);
  }
});

test("READONLY solo recibe keys .view, y ninguna clínica (expediente, recetas, consentimientos, placas)", () => {
  for (const k of ROLE_DEFAULT_PERMISSIONS.READONLY) {
    assert.ok(k.endsWith(".view"), `READONLY tiene ${k}, que no es de lectura`);
    assert.ok(
      !/^(medicalRecord|prescription|consents|xrays)\./.test(k),
      `READONLY tiene ${k}, que es un documento clínico`,
    );
  }
  assert.equal(hasPermission(u("READONLY"), "arco.manage"), false);
});

test("SUPER_ADMIN y ADMIN tienen el catálogo entero; lo que es solo del dueño se gatea por ROL, no por interruptor", () => {
  assert.deepEqual([...ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN].sort(), [...ALL_PERMISSION_KEYS].sort());
  assert.deepEqual([...ROLE_DEFAULT_PERMISSIONS.ADMIN].sort(), [...ALL_PERMISSION_KEYS].sort());
});

test("las descripciones del modal dicen lo que el interruptor hace (sin '(admin)' ni '(solo SUPER_ADMIN)' que ya no describen el gate)", () => {
  assert.ok(!ALL_PERMISSIONS["treatments.edit"].includes("(admin)"), "treatments.edit ya no es solo admin");
  assert.ok(!ALL_PERMISSIONS["team.edit"].includes("SUPER_ADMIN"), "team.edit ya lo tiene ADMIN por default");
  assert.ok(!ALL_PERMISSIONS["suppliers.view"].includes("comprar"), "comprar es suppliers.order");
});

// ─────────────────────────────────────────────────────────────────────
// 5 · EQ-07 — ningún interruptor del modal se queda sin lector
// ─────────────────────────────────────────────────────────────────────

const SRC_ROOT = join(__dirname, "..", "..", "..");           // src/
const CATALOG_FILE = join(SRC_ROOT, "lib", "auth", "permissions.ts");

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Archivos donde una key cuenta como EXIGIDA en servidor (no solo escondida). */
function isServerFile(rel: string): boolean {
  const r = rel.split(sep).join("/");
  return (
    r.startsWith("app/api/") ||
    r.startsWith("app/actions/") ||
    r.startsWith("lib/") ||
    /^app\/.*\/(page|layout)\.tsx?$/.test(r)
  );
}

const sources = (() => {
  const files = walk(SRC_ROOT, []).filter((f) => f !== CATALOG_FILE);
  return files.map((f) => ({ rel: relative(SRC_ROOT, f), text: readFileSync(f, "utf8") }));
})();

function readersOf(key: string): string[] {
  const re = new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
  return sources.filter((s) => re.test(s.text)).map((s) => s.rel);
}

test("EQ-07: cada key del catálogo la lee ALGUIEN fuera de permissions.ts (ningún interruptor muerto)", () => {
  const muertas: string[] = [];
  for (const k of ALL_PERMISSION_KEYS) {
    if (readersOf(k).length === 0) muertas.push(k);
  }
  assert.deepEqual(
    muertas,
    [],
    `interruptores del modal que no lee nadie: ${muertas.join(", ")} — o se cablean, o se sacan del catálogo`,
  );
});

test("EQ-07: cada key EXIGIDA aparece en un route handler, server action, página o lib (no solo en el sidebar)", () => {
  const soloUi: string[] = [];
  for (const k of ENFORCED_KEYS) {
    const server = readersOf(k).filter(isServerFile);
    if (server.length === 0) soloUi.push(k);
  }
  assert.deepEqual(soloUi, [], `keys que se declaran exigidas pero solo las lee la UI: ${soloUi.join(", ")}`);
});

test("EQ-07: las 14 rutas de ISO-03 y las de los interruptores cableados exigen la key que se dijo", () => {
  const expectativas: Array<[string, PermissionKey]> = [
    ["app/api/prescriptions/route.ts", "prescription.view"],
    ["app/api/prescriptions/route.ts", "prescription.create"],
    ["app/api/prescriptions/[id]/route.ts", "prescription.create"],
    ["app/api/prescriptions/[id]/pdf/route.ts", "prescription.view"],
    ["app/api/prescriptions/[id]/send/route.ts", "prescription.view"],
    ["app/api/prescriptions/check-contraindications/route.ts", "prescription.create"],
    ["app/api/clinical-notes/[id]/route.ts", "medicalRecord.edit"],
    ["app/api/consult/ai-assist/route.ts", "medicalRecord.edit"],
    ["app/api/patients/[id]/export-cda/route.ts", "medicalRecord.view"],
    ["app/api/patients/[id]/models-3d/[fileId]/route.ts", "medicalRecord.edit"],
    ["app/api/xrays/[id]/route.ts", "medicalRecord.edit"],
    ["app/api/arco/[id]/route.ts", "arco.manage"],
    ["app/dashboard/settings/arco-requests/page.tsx", "arco.manage"],
    ["app/api/xrays/route.ts", "xrays.view"],
    ["app/api/xrays/route.ts", "xrays.upload"],
    ["app/api/xrays/[id]/analyze/route.ts", "xrays.analyze"],
    ["app/api/xrays/[id]/analyze/route.ts", "xrays.view"],
    ["app/api/xrays/[id]/annotations/route.ts", "xrays.view"],
    ["app/dashboard/xrays/page.tsx", "xrays.view"],
    ["app/dashboard/xrays/[patientId]/page.tsx", "xrays.view"],
    ["app/api/treatments/route.ts", "treatments.view"],
    ["app/api/treatments/route.ts", "treatments.edit"],
    ["app/api/treatments/[id]/route.ts", "treatments.edit"],
    ["app/dashboard/treatments/page.tsx", "treatments.view"],
    ["app/api/inventory/route.ts", "inventory.edit"],
    ["app/api/inventory/[id]/route.ts", "inventory.edit"],
    ["app/api/compras/orders/route.ts", "suppliers.order"],
    ["app/api/compras/orders/[orderId]/pay/route.ts", "suppliers.order"],
    ["app/api/compras/orders/[orderId]/reorder/route.ts", "suppliers.order"],
    ["app/api/dental-labs/[labId]/ordenes/route.ts", "suppliers.order"],
    ["app/api/tv-displays/route.ts", "tvModes.edit"],
    ["app/api/tv-displays/[id]/route.ts", "tvModes.edit"],
    ["app/api/team/route.ts", "team.edit"],
    ["app/api/team/[id]/route.ts", "team.edit"],
    ["app/api/settings/route.ts", "settings.edit"],
    ["app/api/settings/route.ts", "settings.view"],
    ["app/api/clinic/route.ts", "settings.edit"],
    ["app/api/settings/schedule/route.ts", "settings.edit"],
    ["app/api/settings/cfdi/route.ts", "settings.edit"],
    ["app/api/settings/cfdi/certificate/route.ts", "settings.edit"],
    ["app/api/procedures/route.ts", "procedures.edit"],
    ["app/api/procedures/[id]/route.ts", "procedures.edit"],
    ["app/api/clinic-layout/route.ts", "clinicLayout.edit"],
    ["app/api/clinic-layout/live-config/route.ts", "clinicLayout.edit"],
    ["app/api/clinic-layout/optimize/route.ts", "clinicLayout.edit"],
    ["app/api/clinic-layout/seed-demo/route.ts", "clinicLayout.edit"],
  ];
  const byRel = new Map(sources.map((s) => [s.rel.split(sep).join("/"), s.text]));
  for (const [rel, key] of expectativas) {
    const text = byRel.get(rel);
    assert.ok(text, `no existe ${rel}`);
    const re = new RegExp(`(denyIfMissingPermission|requirePermissionOrRedirect|hasPermission)\\([^)]*["']${key.replace(".", "\\.")}["']`);
    assert.ok(re.test(text!), `${rel} no exige "${key}" con la capa moderna`);
  }
});

test("ISO-03: no queda ninguna llamada legacy `hasPermission(<rol>, \"entidad.acción\")` en src/", () => {
  // Un string como primer argumento: `hasPermission(ctx.role`, `hasPermission(user.role`,
  // `hasPermission(dbUser.role`. La forma moderna recibe SIEMPRE un objeto.
  // Se ignoran los comentarios: las rutas migradas cuentan en un comentario
  // qué llamada había antes, y eso no es una llamada.
  const legacyCall = /hasPermission\(\s*[A-Za-z_.]*\.role\b/;
  const esComentario = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
  const culpables = sources
    .filter((s) => s.text.split("\n").some((line) => !esComentario(line) && legacyCall.test(line)))
    .map((s) => s.rel);
  assert.deepEqual(culpables, [], `llamadas legacy por rol: ${culpables.join(", ")}`);
});

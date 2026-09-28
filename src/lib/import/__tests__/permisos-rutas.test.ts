/**
 * ws1-t6 — permisos de las rutas de /api/import: importar ES crear, así que cada
 * ruta exige la misma llave que crear a mano lo que importa.
 *   · /api/import/appointments → agenda.create
 *   · /api/import/balances     → billing.create
 *   · /api/import/assisted     → ADMIN/RECEPTIONIST con patients.create (antes: cualquier sesión)
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/permisos-rutas.test.ts
 *
 * Se ejecutan los route handlers DE VERDAD con el `denyIfMissingPermission` y los
 * permisos por rol REALES (no se falsean). Solo se sustituye la sesión
 * (`getAuthContext`), el límite de tasa y Prisma/audit. Un gate que pasa se nota
 * porque la ruta sigue y falla DESPUÉS con 400 («FormData inválido»), no con 403.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

type Sesion = { userId: string; clinicId: string; role: string; permissionsOverride: string[]; isSuperAdmin: boolean } | null;
let sesion: Sesion = null;

// Réplica literal de requireRole (src/lib/auth-context.ts): el módulo real arrastra la sesión de Supabase.
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => sesion,
    requireRole: (ctx: Sesion, ...roles: string[]) => {
      if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      if (!roles.includes(ctx.role) && !ctx.isSuperAdmin) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
      return null;
    },
  },
});
mock.module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: () => ({}) }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true }) } });
mock.module("@/lib/storage-quota", { namedExports: { storageQuotaError: async () => null } });
mock.module("@/lib/support/service", { namedExports: { createTicket: async () => ({ id: "t", folioLabel: "#DC-0001" }) } });

const sesionDe = (role: string, permissionsOverride: string[] = []): Sesion => ({
  userId: "u1", clinicId: "cli_A", role, permissionsOverride, isSuperAdmin: false,
});

/** POST sin cuerpo válido: si el gate pasa, la ruta responde 400 (FormData inválido); si no, 401/403. */
async function llamar(ruta: string): Promise<number> {
  const mod = await import(ruta);
  const req = new NextRequest("http://localhost/api/import/x", { method: "POST", body: "no-es-form-data", headers: { "content-type": "text/plain" } });
  const res: Response = await mod.POST(req);
  return res.status;
}

const CITAS = "../../../app/api/import/appointments/route";
const SALDOS = "../../../app/api/import/balances/route";
const ASISTIDA = "../../../app/api/import/assisted/route";
const TRATAMIENTOS = "../../../app/api/import/treatment-plans/route";
const ARCHIVOS_MATCH = "../../../app/api/import/patient-files/match/route";
const ARCHIVOS_SIGN = "../../../app/api/import/patient-files/sign/route";
const ARCHIVOS_CONFIRM = "../../../app/api/import/patient-files/confirm/route";
const ARCHIVOS_ABORT = "../../../app/api/import/patient-files/abort/route";
const ODONTOGRAMA = "../../../app/api/import/odontogram/route";
const NOTAS_TRATAMIENTO = "../../../app/api/import/treatment-notes/route";

test("citas: exige agenda.create además del rol", async () => {
  sesion = sesionDe("ADMIN");
  assert.equal(await llamar(CITAS), 400, "un admin pasa el gate");
  sesion = sesionDe("RECEPTIONIST");
  assert.equal(await llamar(CITAS), 400, "recepción tiene agenda.create por defecto");
  // A recepción se le quitó «Crear citas» en Equipo → Permisos: el rol solo ya no basta.
  sesion = sesionDe("RECEPTIONIST", ["agenda.view", "patients.view", "patients.create"]);
  assert.equal(await llamar(CITAS), 403);
  sesion = sesionDe("DOCTOR");
  assert.equal(await llamar(CITAS), 403, "el doctor no importa citas en masa");
  sesion = null;
  assert.equal(await llamar(CITAS), 401);
});

test("saldos: exige billing.create además del rol", async () => {
  sesion = sesionDe("ADMIN");
  assert.equal(await llamar(SALDOS), 400);
  sesion = sesionDe("RECEPTIONIST");
  assert.equal(await llamar(SALDOS), 400, "recepción tiene billing.create por defecto");
  sesion = sesionDe("RECEPTIONIST", ["agenda.view", "agenda.create", "patients.create"]);
  assert.equal(await llamar(SALDOS), 403, "sin billing.create no se crean facturas por importación");
  sesion = sesionDe("DOCTOR");
  assert.equal(await llamar(SALDOS), 403);
  sesion = sesionDe("READONLY");
  assert.equal(await llamar(SALDOS), 403);
});

test("migración asistida: antes no tenía ningún control de rol; ahora solo ADMIN/RECEPTIONIST con patients.create", async () => {
  sesion = sesionDe("ADMIN");
  assert.equal(await llamar(ASISTIDA), 400);
  sesion = sesionDe("RECEPTIONIST");
  assert.equal(await llamar(ASISTIDA), 400);
  sesion = sesionDe("DOCTOR");
  assert.equal(await llamar(ASISTIDA), 403, "un doctor no sube el respaldo entero de la clínica");
  sesion = sesionDe("READONLY");
  assert.equal(await llamar(ASISTIDA), 403);
  // Recepción sin «Crear pacientes»: no abre el asistente ni por esta ruta.
  sesion = sesionDe("RECEPTIONIST", ["patients.view"]);
  assert.equal(await llamar(ASISTIDA), 403);
  sesion = null;
  assert.equal(await llamar(ASISTIDA), 401);
});

test("tratamientos activos: exige billing.create Y treatments.edit (crea factura Y plan de un solo golpe)", async () => {
  sesion = sesionDe("ADMIN");
  assert.equal(await llamar(TRATAMIENTOS), 400, "un admin pasa el gate");
  sesion = sesionDe("RECEPTIONIST");
  assert.equal(await llamar(TRATAMIENTOS), 400, "recepción tiene las dos llaves por defecto");
  // Sin billing.create (aunque conserve treatments.edit): no se crea la factura.
  sesion = sesionDe("RECEPTIONIST", ["patients.view", "treatments.edit"]);
  assert.equal(await llamar(TRATAMIENTOS), 403);
  // Sin treatments.edit (aunque conserve billing.create): no se crea el plan.
  sesion = sesionDe("RECEPTIONIST", ["patients.view", "billing.create"]);
  assert.equal(await llamar(TRATAMIENTOS), 403);
  sesion = sesionDe("DOCTOR");
  assert.equal(await llamar(TRATAMIENTOS), 403, "el doctor no importa tratamientos en masa");
  sesion = sesionDe("READONLY");
  assert.equal(await llamar(TRATAMIENTOS), 403);
  sesion = null;
  assert.equal(await llamar(TRATAMIENTOS), 401);
});

test("odontograma: solo quien puede escribir el odontograma en el panel (ADMIN/DOCTOR) — sin permiso extra", async () => {
  sesion = sesionDe("ADMIN");
  assert.equal(await llamar(ODONTOGRAMA), 400, "un admin pasa el gate");
  sesion = sesionDe("DOCTOR");
  assert.equal(await llamar(ODONTOGRAMA), 400, "el doctor escribe el odontograma en el panel, y también en bloque");
  sesion = sesionDe("RECEPTIONIST");
  assert.equal(await llamar(ODONTOGRAMA), 403, "recepción no escribe el odontograma, ni a mano ni en bloque");
  sesion = sesionDe("READONLY");
  assert.equal(await llamar(ODONTOGRAMA), 403);
  sesion = null;
  assert.equal(await llamar(ODONTOGRAMA), 401);
});

test("notas de tratamiento: exige medicalRecord.edit Y treatments.edit (puede escribir en el expediente o en una sesión)", async () => {
  sesion = sesionDe("ADMIN");
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 400, "un admin pasa el gate");
  // Recepción SÍ tiene treatments.edit por default, pero NO medicalRecord.edit
  // (igual que /api/import/clinical-notes): una nota clínica no la migra quien
  // no puede escribirla, aunque sea a un tratamiento.
  sesion = sesionDe("RECEPTIONIST");
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 403, "recepción no tiene medicalRecord.edit por default");
  sesion = sesionDe("RECEPTIONIST", ["patients.view", "medicalRecord.edit", "treatments.edit"]);
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 400, "con las dos llaves, recepción sí puede");
  sesion = sesionDe("RECEPTIONIST", ["patients.view", "medicalRecord.edit"]);
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 403, "sin treatments.edit no se puede agregar a una sesión");
  sesion = sesionDe("RECEPTIONIST", ["patients.view", "treatments.edit"]);
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 403, "sin medicalRecord.edit no se puede escribir en el expediente");
  sesion = sesionDe("DOCTOR");
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 403, "el doctor no importa notas en masa (igual que el resto del importador)");
  sesion = sesionDe("READONLY");
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 403);
  sesion = null;
  assert.equal(await llamar(NOTAS_TRATAMIENTO), 401);
});

test("archivos en bloque (match/sign/confirm/abort): las 4 exigen xrays.upload además del rol, igual que registrar un archivo a mano", async () => {
  for (const ruta of [ARCHIVOS_MATCH, ARCHIVOS_SIGN, ARCHIVOS_CONFIRM, ARCHIVOS_ABORT]) {
    sesion = sesionDe("ADMIN");
    assert.equal(await llamar(ruta), 400, `${ruta}: un admin pasa el gate`);
    sesion = sesionDe("RECEPTIONIST");
    assert.equal(await llamar(ruta), 400, `${ruta}: recepción tiene xrays.upload por defecto`);
    sesion = sesionDe("RECEPTIONIST", ["patients.view"]);
    assert.equal(await llamar(ruta), 403, `${ruta}: sin xrays.upload no se registran archivos por importación`);
    sesion = sesionDe("READONLY");
    assert.equal(await llamar(ruta), 403, `${ruta}: solo lectura no sube nada`);
    sesion = null;
    assert.equal(await llamar(ruta), 401, `${ruta}: sin sesión`);
  }
});

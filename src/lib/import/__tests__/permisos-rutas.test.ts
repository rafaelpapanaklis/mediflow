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

/**
 * LA FILA DE ESPERA (WALK-IN) PIDE PERMISO — ws1-t4.
 *
 * Run: npm run test:walk-in-permisos
 *
 * Antes /api/walk-in y la página solo pedían sesión: cualquier usuario de la
 * clínica (solo lectura incluido) metía gente a la fila. Ahora:
 *   ver la fila        → agenda.view   (GET y la página)
 *   agregar            → agenda.create (POST y el botón «Agregar a espera»)
 *   avanzar / cancelar → agenda.edit   (PATCH y DELETE de /[id])
 * Dueño (ADMIN) y recepción pueden todo; el doctor también (tiene los cuatro
 * de fábrica); solo lectura únicamente ve.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let sinSesion = false;
const ctx: any = { userId: "u1", clinicId: "c1", role: "RECEPTIONIST", permissionsOverride: [] };
let creadas: any[];
let tocadas: string[];

beforeEach(() => {
  creadas = [];
  tocadas = [];
  sinSesion = false;
  ctx.role = "RECEPTIONIST";
  ctx.permissionsOverride = [];
});

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => (sinSesion ? null : ctx) } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      walkInQueue: {
        findMany: async (a: any) => { tocadas.push("findMany"); assert.equal(a.where.clinicId, "c1"); return []; },
        findFirst: async () => ({ id: "w1", clinicId: "c1" }),
        create: async (a: any) => { creadas.push(a.data); return { id: "w1", ...a.data }; },
        updateMany: async () => ({ count: 1 }),
        deleteMany: async () => { tocadas.push("deleteMany"); return { count: 1 }; },
      },
    },
  },
});

const req = (body?: any) => ({ json: async () => body }) as any;
const idp = { params: { id: "w1" } };
const ROLES = ["ADMIN", "RECEPTIONIST", "DOCTOR"] as const;

test("dueño, recepción y doctor: ven, agregan, avanzan y cancelan", async () => {
  const { GET, POST } = await import("@/app/api/walk-in/route");
  const { PATCH, DELETE } = await import("@/app/api/walk-in/[id]/route");
  for (const role of ROLES) {
    ctx.role = role;
    assert.equal((await GET(req())).status, 200, `${role} GET`);
    assert.equal((await POST(req({ patientName: "Ana", service: "Limpieza" }))).status, 201, `${role} POST`);
    assert.equal((await PATCH(req({ action: "cancel" }), idp)).status, 200, `${role} PATCH`);
    assert.equal((await DELETE(req(), idp)).status, 200, `${role} DELETE`);
  }
});

test("solo lectura: ve la fila pero no agrega ni toca turnos (403, sin escribir)", async () => {
  const { GET, POST } = await import("@/app/api/walk-in/route");
  const { PATCH, DELETE } = await import("@/app/api/walk-in/[id]/route");
  ctx.role = "READONLY";
  assert.equal((await GET(req())).status, 200);
  const r = await POST(req({ patientName: "Ana", service: "Limpieza" }));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).permiso, "agenda.create");
  assert.equal((await PATCH(req({ action: "start" }), idp)).status, 403);
  assert.equal((await DELETE(req(), idp)).status, 403);
  assert.deepEqual(creadas, []);
  assert.ok(!tocadas.includes("deleteMany"));
});

test("permiso a medida: recepción sin agenda.create ya no agrega; sin agenda.view ni lee", async () => {
  const { GET, POST } = await import("@/app/api/walk-in/route");
  ctx.role = "RECEPTIONIST";
  // El override reemplaza el set del rol (lista de permisos efectivos).
  ctx.permissionsOverride = ["today.view", "agenda.view"];
  assert.equal((await GET(req())).status, 200);
  assert.equal((await POST(req({ patientName: "Ana", service: "x" }))).status, 403);
  ctx.permissionsOverride = ["today.view"];
  assert.equal((await GET(req())).status, 403);
  assert.deepEqual(tocadas.filter((t) => t === "findMany").length, 1);
});

test("sin sesión sigue siendo 401", async () => {
  const { GET, POST } = await import("@/app/api/walk-in/route");
  sinSesion = true;
  assert.equal((await GET(req())).status, 401);
  assert.equal((await POST(req({ patientName: "Ana", service: "x" }))).status, 401);
});

test("la página y los botones usan los mismos permisos que la API", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = leer("src/app/dashboard/walk-in/page.tsx");
  assert.match(page, /requirePermissionOrRedirect\(user, "agenda\.view"\)/);
  assert.match(page, /hasPermission\(quien, "agenda\.create"\)/);
  assert.match(page, /hasPermission\(quien, "agenda\.edit"\)/);
  const home = leer("src/app/dashboard/page.tsx");
  assert.match(home, /"agenda\.create"/);
  assert.equal((home.match(/puedeAgregarEspera=\{puedeAgregarEspera\}/g) ?? []).length, 2);
  for (const f of [
    "src/components/dashboard/hoy-rediseno/hoy-recepcion.tsx",
    "src/components/dashboard/home/home-receptionist.tsx",
  ]) assert.match(leer(f), /puedeAgregarEspera/);
  assert.match(leer("src/components/dashboard/piezas-rediseno/fila-espera.tsx"), /puedeAgregar &&/);
});

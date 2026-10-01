/**
 * Equipo — el tope de usuarios del plan (ws1-t8).
 *
 * `npm run test:team-cupo`
 *
 * El caso real: una clínica Básica (3 usuarios) con sus 3 podía abrir «Agregar
 * miembro» y llenar el formulario; el error solo salía al guardar. Aquí se
 * ejecutan los route handlers DE VERDAD con la MISMA función de cupo que lee la
 * pantalla (getCupoUsuarios). Dobles: sesión, Prisma, Supabase, bitácora, caché
 * y la config de planes (el tope sale de `maxUsers`, con overrides de /admin).
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { cupoDeUsuarios } from "../cupo-usuarios-shared";

const CL = "clinica-basico";
const CL_OTRA = "clinica-otra";

interface Fila { id: string; clinicId: string; email: string; isActive: boolean; role: string; color: string; supabaseId: string }
const estado = { filas: [] as Fila[], maxUsers: 3 as number | null, creados: 0 };

const f = (id: string, over: Partial<Fila> = {}): Fila => ({
  id, clinicId: CL, email: `${id}@x.com`, isActive: true, role: "DOCTOR", color: "#111111",
  supabaseId: "11111111-1111-4111-8111-111111111111", ...over,
});
const coincide = (r: Fila, w: any) =>
  (w?.clinicId === undefined || r.clinicId === w.clinicId) &&
  (w?.isActive === undefined || r.isActive === w.isActive) &&
  (typeof w?.id !== "string" || r.id === w.id);

const prismaDoble: any = {
  user: {
    findMany: async ({ where }: any) => estado.filas.filter((r) => coincide(r, where)),
    findFirst: async ({ where }: any) => estado.filas.find((r) => coincide(r, where)) ?? null,
    count: async ({ where }: any) => estado.filas.filter((r) => coincide(r, where)).length,
    create: async ({ data }: any) => { estado.creados++; return { id: "nuevo", ...data, createdAt: new Date(), updatedAt: new Date() }; },
    update: async ({ where, data }: any) => { const r = estado.filas.find((x) => x.id === where.id)!; Object.assign(r, data); return { ...r }; },
    updateMany: async () => ({ count: 1 }),
  },
  clinic: { findUnique: async () => ({ plan: "BASIC" }) },
  $transaction: async (fn: any) => fn(prismaDoble),
};

let ALTA: (b: unknown) => Promise<Response>;
let PATCH: (id: string, b: unknown) => Promise<Response>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module(require.resolve("@supabase/supabase-js"), {
    namedExports: { createClient: () => ({ auth: { admin: {
      createUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } }, error: null }),
      updateUserById: async () => ({ data: {}, error: null }),
      deleteUser: async () => ({ error: null }),
    } } }) },
  });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => ({
    userId: "dueno", clinicId: CL, role: "SUPER_ADMIN", permissionsOverride: [], clinicCategory: "DENTAL",
    clinic: { name: "Prueba", timezone: "America/Mexico_City", category: "DENTAL" }, isSuperAdmin: true, isAdmin: true,
  }) } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", { namedExports: { ...auditReal, logMutation: async () => {}, logAudit: async () => {} } });
  mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => false } });
  mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: estado.maxUsers }) } });
  mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
  mock.module("@/lib/auth/must-change-password", { namedExports: { markMustChangePassword: async () => {} } });

  const { NextRequest } = await import("next/server");
  const ruta = await import("@/app/api/team/[id]/route");
  const alta = await import("@/app/api/team/route");
  ALTA = (b) => alta.POST(new NextRequest("http://app.test/api/team", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  }));
  PATCH = (id, b) => ruta.PATCH(new NextRequest(`http://app.test/api/team/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  }), { params: { id } });
});

beforeEach(() => {
  estado.maxUsers = 3; estado.creados = 0;
  estado.filas = [f("a"), f("b"), f("c"), f("inactivo", { isActive: false }), f("ajeno", { clinicId: CL_OTRA })];
});

const nuevo = { firstName: "Ana", lastName: "Pérez", email: "ana@x.com", role: "DOCTOR" };

test("cupoDeUsuarios: lleno solo con tope y usados >= tope", () => {
  assert.deepEqual(cupoDeUsuarios(3, 3), { usados: 3, max: 3, lleno: true });
  assert.equal(cupoDeUsuarios(2, 3).lleno, false);
  assert.equal(cupoDeUsuarios(99, null).lleno, false);
  assert.equal(cupoDeUsuarios(99, undefined).max, null);
});

test("🔴 alta con el cupo lleno (3 de 3; el desactivado y el de otra clínica no cuentan) → 402 y no crea nada", async () => {
  const r = await ALTA(nuevo);
  assert.equal(r.status, 402);
  const j = await r.json();
  assert.equal(j.code, "PLAN_LIMIT_USERS");
  assert.equal(j.limit, 3);
  assert.equal(estado.creados, 0);
});

test("alta con cupo libre (2 de 3) → pasa", async () => {
  estado.filas = estado.filas.filter((r) => r.id !== "c");
  const r = await ALTA(nuevo);
  assert.equal(r.status, 201);
  assert.equal(estado.creados, 1);
});

test("el tope personalizado de /admin manda: maxUsers 5 deja pasar el 4º; sin tope (null) también", async () => {
  estado.maxUsers = 5;
  assert.equal((await ALTA(nuevo)).status, 201);
  estado.maxUsers = null;
  assert.equal((await ALTA({ ...nuevo, email: "otra@x.com" })).status, 201);
});

test("🔴 reactivar con el cupo lleno → 402 y el miembro sigue inactivo", async () => {
  const r = await PATCH("inactivo", { isActive: true });
  assert.equal(r.status, 402);
  assert.equal((await r.json()).code, "PLAN_LIMIT_USERS");
  assert.equal(estado.filas.find((x) => x.id === "inactivo")!.isActive, false);
});

test("reactivar con cupo libre pasa; desactivar siempre se permite", async () => {
  estado.maxUsers = 4;
  assert.equal((await PATCH("inactivo", { isActive: true })).status, 200);
  estado.maxUsers = 1;
  assert.equal((await PATCH("a", { isActive: false })).status, 200);
});

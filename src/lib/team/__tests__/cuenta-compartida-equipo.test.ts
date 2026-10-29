/**
 * Seguridad (auditoría «cloudflare», nº5): Equipo ya no reescribe el login
 * global de una persona que usa la misma cuenta en otro lugar, y cambiar el
 * correo de OTRO miembro es solo del SUPER_ADMIN.
 *
 * Run: npm run test:seg-equipo-identidad
 *   (--experimental-test-module-mocks: se ejecutan de verdad PATCH /api/team/[id],
 *    POST /api/team/[id]/set-password y POST /api/team/[id]/reset-password, con
 *    la sesión, Prisma, la bitácora y el cliente de administración de Supabase
 *    sustituidos. Sin red ni base.)
 *
 * Con el código de 0f61a7e0d:
 *   · un ADMIN (con `team.edit`) le cambiaba el correo de acceso a un doctor
 *     (updateUserById con email_confirm:true) y después pedía «olvidé mi
 *     contraseña» al correo nuevo;
 *   · el correo y la contraseña se cambiaban aunque esa cuenta entrara también
 *     al Instituto, a una cuenta de afiliado o a otra clínica.
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const CL = "cl-a";
const CL_SEDE = "cl-a-sede2"; // otra sede del MISMO dueño
const CL_AJENA = "cl-ajena";
const SB_DUENO = "11111111-1111-4111-8111-111111111111";
const SB_ADMIN = "44444444-4444-4444-8444-444444444444";
const SB_DOC = "26e82327-e7f4-4d26-a671-902901627219";

interface Fila {
  id: string; clinicId: string; supabaseId: string; role: string; email: string;
  firstName: string; lastName: string; isActive: boolean; cedulaProfesional: string | null;
  permissionsOverride?: string[];
}

const estado = {
  sesion: null as any,
  filas: [] as Fila[],
  edu: [] as Array<{ id: string; supabaseId: string }>,
  afiliados: [] as Array<{ id: string; supabaseId: string }>,
  authUpdate: [] as any[],
  bitacora: [] as any[],
};

function fila(over: Partial<Fila> = {}): Fila {
  return {
    id: "doc1", clinicId: CL, supabaseId: SB_DOC, role: "DOCTOR", email: "doctora@clinica.test",
    firstName: "Laura", lastName: "Ríos", isActive: true, cedulaProfesional: null, ...over,
  };
}

function coincide(f: Fila, where: any): boolean {
  if (!where) return true;
  if (typeof where.id === "string" && f.id !== where.id) return false;
  if (where.id?.in && !where.id.in.includes(f.id)) return false;
  if (typeof where.clinicId === "string" && f.clinicId !== where.clinicId) return false;
  if (where.clinicId?.in && !where.clinicId.in.includes(f.clinicId)) return false;
  if (where.clinicId?.notIn && where.clinicId.notIn.includes(f.clinicId)) return false;
  if (typeof where.supabaseId === "string" && f.supabaseId !== where.supabaseId) return false;
  if (where.supabaseId?.not !== undefined && f.supabaseId === where.supabaseId.not) return false;
  if (typeof where.role === "string" && f.role !== where.role) return false;
  if (typeof where.isActive === "boolean" && f.isActive !== where.isActive) return false;
  if (where.email?.equals && f.email.toLowerCase() !== String(where.email.equals).toLowerCase()) return false;
  return true;
}

const prismaDoble: any = {
  user: {
    findFirst: async ({ where }: any) => {
      const f = estado.filas.find((x) => coincide(x, where));
      return f ? { ...f, _count: { appointments: 0, records: 0 } } : null;
    },
    findMany: async ({ where }: any) => estado.filas.filter((x) => coincide(x, where)).map((x) => ({ ...x })),
    count: async ({ where }: any) => estado.filas.filter((x) => coincide(x, where)).length,
    update: async ({ where, data }: any) => {
      const f = estado.filas.find((x) => x.id === where.id)!;
      Object.assign(f, data);
      return { ...f };
    },
    updateMany: async ({ where, data }: any) => {
      const hit = estado.filas.filter((x) => coincide(x, where));
      hit.forEach((f) => Object.assign(f, data));
      return { count: hit.length };
    },
  },
  eduUser: { findFirst: async ({ where }: any) => estado.edu.find((e) => e.supabaseId === where.supabaseId) ?? null },
  affiliateUser: { findFirst: async ({ where }: any) => estado.afiliados.find((a) => a.supabaseId === where.supabaseId) ?? null },
  clinic: { findUnique: async () => ({}) },
  $transaction: async (fn: any) => fn(prismaDoble),
};

const adminDoble = {
  auth: {
    admin: {
      updateUserById: async (id: string, attrs: any) => {
        estado.authUpdate.push({ id, attrs });
        return { data: {}, error: null };
      },
      createUser: async () => ({ data: { user: { id: "x" } }, error: null }),
      deleteUser: async () => ({ error: null }),
    },
  },
};

function sesion(role: "SUPER_ADMIN" | "ADMIN", userId: string) {
  return {
    userId, clinicId: CL, role, permissionsOverride: [], clinicCategory: "DENTAL",
    clinic: { timezone: "America/Mexico_City", category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN", isAdmin: true,
  };
}

let PATCH: (id: string, body: unknown) => Promise<Response>;
let SET: (id: string, body: unknown) => Promise<Response>;
let RESET: (id: string) => Promise<Response>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module(require.resolve("@supabase/supabase-js"), { namedExports: { createClient: () => adminDoble } });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => estado.sesion } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", {
    namedExports: {
      ...auditReal,
      logMutation: async (o: any) => { estado.bitacora.push(o); },
      logAudit: async (o: any) => { estado.bitacora.push(o); },
    },
  });
  mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => true } });
  mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: null }) } });
  mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
  mock.module("@/lib/auth/must-change-password", {
    namedExports: { markMustChangePassword: async () => {}, clearMustChangePassword: async () => {} },
  });

  const { NextRequest } = await import("next/server");
  const ruta = await import("@/app/api/team/[id]/route");
  const set = await import("@/app/api/team/[id]/set-password/route");
  const reset = await import("@/app/api/team/[id]/reset-password/route");
  const req = (metodo: string, url: string, body?: unknown) =>
    new NextRequest(`http://app.test/api/team/${url}`, {
      method: metodo,
      headers: { "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  PATCH = (id, body) => ruta.PATCH(req("PATCH", id, body), { params: Promise.resolve({ id }) });
  SET = (id, body) => set.POST(req("POST", `${id}/set-password`, body), { params: Promise.resolve({ id }) });
  RESET = (id) => reset.POST(req("POST", `${id}/reset-password`), { params: Promise.resolve({ id }) });
});

beforeEach(() => {
  Object.assign(estado, {
    sesion: sesion("SUPER_ADMIN", "us-dueno"),
    filas: [
      fila(),
      fila({ id: "us-dueno", role: "SUPER_ADMIN", supabaseId: SB_DUENO, email: "dueno@clinica.test", firstName: "Dueño" }),
      fila({ id: "us-dueno-sede2", clinicId: CL_SEDE, role: "SUPER_ADMIN", supabaseId: SB_DUENO, email: "dueno@clinica.test" }),
      fila({ id: "us-admin", role: "ADMIN", supabaseId: SB_ADMIN, email: "admin@clinica.test", firstName: "Admin" }),
    ],
    edu: [], afiliados: [], authUpdate: [], bitacora: [],
  });
});

const NUEVO = "atacante@correo.test";
const CONTRA = "Contrasena-Nueva-2026!";

test("nº5 · un ADMIN (team.edit) ya no le cambia el correo de acceso a otro miembro: 403 y Supabase no se toca", async () => {
  estado.sesion = sesion("ADMIN", "us-admin");
  const r = await PATCH("doc1", { email: NUEVO });
  assert.equal(r.status, 403);
  assert.equal(estado.authUpdate.length, 0, "updateUserById no se llama");
  assert.equal(estado.filas.find((f) => f.id === "doc1")!.email, "doctora@clinica.test");
});

test("nº5 · cuenta que también entra al INSTITUTO: el SUPER_ADMIN no le cambia el correo ni la contraseña (409)", async () => {
  estado.edu = [{ id: "edu1", supabaseId: SB_DOC }];
  const r = await PATCH("doc1", { email: NUEVO });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, "CUENTA_COMPARTIDA");
  assert.match(j.error, /misma cuenta de acceso en otro lugar/);
  assert.match(j.error, /que los cambie ella/);
  const s = await SET("doc1", { password: CONTRA, confirmacion: CONTRA });
  assert.equal(s.status, 409);
  assert.equal((await s.json()).code, "CUENTA_COMPARTIDA");
  const rs = await RESET("doc1");
  assert.equal(rs.status, 409);
  assert.equal(estado.authUpdate.length, 0, "ni correo ni contraseña globales");
});

test("nº5 · cuenta que también es AFILIADO: 409 en correo, contraseña fija y temporal", async () => {
  estado.afiliados = [{ id: "af1", supabaseId: SB_DOC }];
  assert.equal((await PATCH("doc1", { email: NUEVO })).status, 409);
  assert.equal((await SET("doc1", { password: CONTRA, confirmacion: CONTRA })).status, 409);
  assert.equal((await RESET("doc1")).status, 409);
  assert.equal(estado.authUpdate.length, 0);
});

test("nº5 · cuenta que también trabaja en OTRA clínica (que no es sede de este dueño): 409", async () => {
  estado.filas.push(fila({ id: "doc1-ajena", clinicId: CL_AJENA, role: "ADMIN" }));
  assert.equal((await PATCH("doc1", { email: NUEVO })).status, 409);
  assert.equal((await SET("doc1", { password: CONTRA, confirmacion: CONTRA })).status, 409);
  assert.equal(estado.authUpdate.length, 0);
});

test("nº5 · lo de siempre sigue: el dueño cambia correo y contraseña de un doctor de SUS sedes", async () => {
  // La doctora también trabaja en la otra sede del MISMO dueño: no es «otro lugar».
  estado.filas.push(fila({ id: "doc1-sede2", clinicId: CL_SEDE }));
  const r = await PATCH("doc1", { email: "laura.rios@clinica.test" });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(estado.authUpdate[0], { id: SB_DOC, attrs: { email: "laura.rios@clinica.test", email_confirm: true } });
  assert.equal(estado.filas.find((f) => f.id === "doc1-sede2")!.email, "laura.rios@clinica.test", "la fila de la otra sede también");
  const s = await SET("doc1", { password: CONTRA, confirmacion: CONTRA });
  assert.equal(s.status, 200);
  assert.deepEqual(estado.authUpdate[1], { id: SB_DOC, attrs: { password: CONTRA } });
});

test("nº5 · cada quien sigue pudiendo cambiar SU propio correo (también un ADMIN)", async () => {
  estado.sesion = sesion("ADMIN", "us-admin");
  const r = await PATCH("us-admin", { email: "admin.nuevo@clinica.test" });
  assert.equal(r.status, 200);
  assert.equal(estado.authUpdate[0]?.attrs?.email, "admin.nuevo@clinica.test");
});

test("nº5 · un ADMIN sigue editando lo demás de un miembro (la cédula) si el correo no cambia", async () => {
  estado.sesion = sesion("ADMIN", "us-admin");
  const r = await PATCH("doc1", { email: "Doctora@Clinica.test", cedulaProfesional: "1234567" });
  assert.equal(r.status, 200);
  assert.equal(estado.filas.find((f) => f.id === "doc1")!.cedulaProfesional, "1234567");
  assert.equal(estado.authUpdate.length, 0);
});

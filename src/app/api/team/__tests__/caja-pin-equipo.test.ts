/**
 * Equipo → Caja (ws1-t1): la casilla «Puede usar Caja», si el miembro tiene PIN
 * y «Restablecer PIN de Caja». Se ejecutan los route handlers de verdad con
 * dobles de sesión, Prisma, bitácora y caché.
 *
 * `npm run test:caja-pin-equipo`
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { camposPublicosDeMiembro, conIndicadorDePin, tieneCajaPin } from "@/lib/team/member-fields";

const CL = "cl-a";
const OTRA = "cl-b";
const HASH = "$2b$10$estoNoPuedeSalirNuncaDelServidor";

interface Fila {
  id: string; clinicId: string; supabaseId: string; role: string; email: string;
  firstName: string; lastName: string; isActive: boolean;
  canAccessCaja: boolean; cajaPinHash: string | null; totpSecret?: string;
}

const estado = {
  sesion: null as any,
  filas: [] as Fila[],
  updates: [] as any[],
  updateMany: [] as any[],
  bitacora: [] as any[],
};

const fila = (o: Partial<Fila> & { id: string }): Fila => ({
  clinicId: CL, supabaseId: `sb-${o.id}`, role: "DOCTOR", email: `${o.id}@x.com`,
  firstName: "Nombre", lastName: "Apellido", isActive: true,
  canAccessCaja: false, cajaPinHash: null, totpSecret: "JBSWY3DPEHPK3PXP", ...o,
});

function coincide(f: Fila, where: any): boolean {
  if (!where) return true;
  if (typeof where.id === "string" && f.id !== where.id) return false;
  if (typeof where.clinicId === "string" && f.clinicId !== where.clinicId) return false;
  return true;
}

/** Prisma de verdad devuelve solo lo que pide `select`; el doble también. */
function conSelect(f: Fila, select: any) {
  if (!select) return { ...f };
  const out: any = {};
  for (const [k, v] of Object.entries(select)) if (v === true) out[k] = (f as any)[k];
  if (select._count) out._count = { appointments: 0, records: 0, primaryPatients: 0 };
  return out;
}

const prismaDoble: any = {
  user: {
    findFirst: async ({ where, select }: any) => {
      const f = estado.filas.find((x) => coincide(x, where));
      return f ? conSelect(f, select) : null;
    },
    findMany: async ({ where, select }: any) => estado.filas.filter((x) => coincide(x, where)).map((x) => conSelect(x, select)),
    update: async ({ where, data }: any) => {
      const f = estado.filas.find((x) => x.id === where.id)!;
      Object.assign(f, data);
      estado.updates.push({ where, data });
      return { ...f };
    },
    updateMany: async ({ where, data }: any) => {
      estado.updateMany.push({ where, data });
      const hit = estado.filas.filter((x) => coincide(x, where));
      hit.forEach((f) => Object.assign(f, data));
      return { count: hit.length };
    },
  },
  clinic: { findUnique: async () => ({}) },
  $transaction: async (fn: any) => fn(prismaDoble),
};

function sesion(role: string, userId: string) {
  return {
    userId, clinicId: CL, role, permissionsOverride: [],
    clinicCategory: "DENTAL",
    clinic: { timezone: "America/Mexico_City", category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN", isAdmin: role === "SUPER_ADMIN" || role === "ADMIN",
  };
}

let PATCH: (id: string, body: unknown) => Promise<Response>;
let GET_ID: (id: string) => Promise<Response>;
let RESET: (id: string, body?: unknown) => Promise<Response>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module(require.resolve("@supabase/supabase-js"), { namedExports: { createClient: () => ({ auth: { admin: {} } }) } });
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

  const { NextRequest } = await import("next/server");
  const rutaId = await import("@/app/api/team/[id]/route");
  const rutaPin = await import("@/app/api/team/[id]/caja-pin/route");
  const req = (url: string, method: string, body?: unknown) =>
    new NextRequest(url, { method, headers: { "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  PATCH = (id, body) => rutaId.PATCH(req(`http://app.test/api/team/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });
  GET_ID = (id) => rutaId.GET(req(`http://app.test/api/team/${id}`, "GET"), { params: Promise.resolve({ id }) });
  RESET = (id, body = { action: "reset" }) =>
    rutaPin.POST(req(`http://app.test/api/team/${id}/caja-pin`, "POST", body), { params: Promise.resolve({ id }) });
});

beforeEach(() => {
  Object.assign(estado, {
    sesion: sesion("SUPER_ADMIN", "dueno"),
    filas: [
      fila({ id: "dueno", role: "SUPER_ADMIN", cajaPinHash: HASH }),
      fila({ id: "doc", role: "DOCTOR", cajaPinHash: HASH }),
      fila({ id: "recep", role: "RECEPTIONIST" }),
      fila({ id: "admin", role: "ADMIN" }),
      fila({ id: "otra-clinica", clinicId: OTRA, role: "DOCTOR", cajaPinHash: HASH }),
      // id importado, no uuid:
      fila({ id: "imp_000123", role: "DOCTOR", cajaPinHash: HASH }),
    ],
    updates: [], updateMany: [], bitacora: [],
  });
});

const f = (id: string) => estado.filas.find((x) => x.id === id)!;
const sinHash = (x: unknown) => assert.ok(!JSON.stringify(x).includes(HASH), "el hash del PIN apareció donde no debía");

/* ── la casilla «Puede usar Caja» manda canAccessCaja ───────────────────── */

test("la casilla marcada viaja como canAccessCaja:true y se guarda", async () => {
  const r = await PATCH("recep", { canAccessCaja: true });
  assert.equal(r.status, 200);
  assert.equal(f("recep").canAccessCaja, true);
  assert.equal(estado.updates[0].data.canAccessCaja, true);
  const cuerpo = await r.json();
  assert.equal(cuerpo.canAccessCaja, true);
});

test("desmarcarla guarda false", async () => {
  f("doc").canAccessCaja = true;
  const r = await PATCH("doc", { canAccessCaja: false });
  assert.equal(r.status, 200);
  assert.equal(f("doc").canAccessCaja, false);
});

test("un valor que no es booleano de verdad se ignora (no se coacciona)", async () => {
  for (const raro of ["true", 1, "yes", null]) {
    estado.updates = [];
    await PATCH("recep", { canAccessCaja: raro, phone: "5551234567" });
    assert.equal(f("recep").canAccessCaja, false, `se coaccionó ${JSON.stringify(raro)}`);
    assert.ok(!("canAccessCaja" in estado.updates[0].data));
  }
});

test("a un SUPER_ADMIN no se le escribe: entra a Caja por rol", async () => {
  const r = await PATCH("dueno", { canAccessCaja: false, phone: "5551234567" });
  assert.equal(r.status, 200);
  assert.equal(f("dueno").canAccessCaja, false, "la columna no se toca");
  assert.ok(!("canAccessCaja" in estado.updates[0].data));
});

test("un ADMIN con team.edit se la da a otro, pero no se la da a sí mismo", async () => {
  estado.sesion = sesion("ADMIN", "admin");
  const aOtro = await PATCH("recep", { canAccessCaja: true });
  assert.equal(aOtro.status, 200);
  assert.equal(f("recep").canAccessCaja, true);

  const aSiMismo = await PATCH("admin", { canAccessCaja: true });
  assert.equal(aSiMismo.status, 403);
  assert.equal(f("admin").canAccessCaja, false);
});

test("un ADMIN que guarda otro dato con la casilla igual a como estaba no tropieza", async () => {
  estado.sesion = sesion("ADMIN", "admin");
  const r = await PATCH("admin", { canAccessCaja: false, phone: "5551234567" });
  assert.equal(r.status, 200);
});

test("quien no tiene team.edit no puede cambiar la casilla", async () => {
  estado.sesion = sesion("RECEPTIONIST", "recep");
  const r = await PATCH("doc", { canAccessCaja: true });
  assert.equal(r.status, 403);
  assert.equal(f("doc").canAccessCaja, false);
});

/* ── si tiene PIN: el booleano sale, el hash no ─────────────────────────── */

test("GET de un miembro trae tieneCajaPin y NUNCA el hash ni el secret TOTP", async () => {
  const r = await GET_ID("doc");
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.tieneCajaPin, true);
  assert.equal(cuerpo.canAccessCaja, false);
  assert.equal("cajaPinHash" in cuerpo, false);
  assert.equal("totpSecret" in cuerpo, false);
  sinHash(cuerpo);

  const sin = await (await GET_ID("recep")).json();
  assert.equal(sin.tieneCajaPin, false);
});

test("la respuesta del PATCH trae tieneCajaPin y ni rastro del hash", async () => {
  const r = await PATCH("doc", { phone: "5551234567" });
  const cuerpo = await r.json();
  assert.equal(cuerpo.tieneCajaPin, true);
  sinHash(cuerpo);
  assert.equal(cuerpo.totpSecret, undefined);
});

test("la bitácora del PATCH no registra el hash (la fila no cambió en esa columna)", async () => {
  await PATCH("recep", { canAccessCaja: true });
  const b = estado.bitacora.at(-1);
  assert.equal(b.entityType, "user");
  assert.equal(b.action, "update");
});

test("tieneCajaPin / conIndicadorDePin / camposPublicosDeMiembro", () => {
  assert.equal(tieneCajaPin({ cajaPinHash: HASH }), true);
  assert.equal(tieneCajaPin({ cajaPinHash: null }), false);
  assert.equal(tieneCajaPin({ cajaPinHash: "" }), false);
  assert.equal(tieneCajaPin({}), false);

  const lectura = conIndicadorDePin({ id: "u", firstName: "A", cajaPinHash: HASH });
  assert.deepEqual(lectura, { id: "u", firstName: "A", tieneCajaPin: true });

  // La proyección de una fila entera: el booleano sale, el hash no.
  const publico = camposPublicosDeMiembro({ id: "u", email: "a@b.c", cajaPinHash: HASH, totpSecret: "X" }) as any;
  assert.equal(publico.tieneCajaPin, true);
  assert.equal("cajaPinHash" in publico, false);
  // Una fila recortada que no trajo el hash no inventa «sin crear».
  const recortada = camposPublicosDeMiembro({ id: "u", email: "a@b.c" }) as any;
  assert.equal("tieneCajaPin" in recortada, false);
});

/* ── «Restablecer PIN de Caja»: solo SUPER_ADMIN, solo su clínica ───────── */

test("el dueño restablece el PIN de un miembro de su clínica: cajaPinHash = null", async () => {
  const r = await RESET("doc");
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.ok, true);
  assert.equal(cuerpo.tieneCajaPin, false);
  assert.equal(f("doc").cajaPinHash, null);
  // La escritura lleva la clínica en el WHERE, no solo la lectura.
  assert.deepEqual(estado.updateMany[0].where, { id: "doc", clinicId: CL });
  assert.deepEqual(estado.updateMany[0].data, { cajaPinHash: null });
  // El acceso a Caja no se toca.
  assert.equal(f("doc").canAccessCaja, false);
});

test("deja un movimiento en la bitácora, sin el hash", async () => {
  await RESET("doc");
  const b = estado.bitacora.at(-1);
  assert.equal(b.entityType, "user");
  assert.equal(b.entityId, "doc");
  assert.equal(b.clinicId, CL);
  assert.equal(b.userId, "dueno");
  assert.deepEqual(b.before, { tieneCajaPin: true });
  assert.deepEqual(b.after, { tieneCajaPin: false });
  sinHash(estado.bitacora);
});

test("un ADMIN (aunque tenga team.edit) NO puede restablecer: 403 y no se toca nada", async () => {
  estado.sesion = sesion("ADMIN", "admin");
  const r = await RESET("doc");
  assert.equal(r.status, 403);
  assert.equal(f("doc").cajaPinHash, HASH);
  assert.equal(estado.updateMany.length, 0);
});

test("un miembro de OTRA clínica: 404 y su PIN queda intacto", async () => {
  const r = await RESET("otra-clinica");
  assert.equal(r.status, 404);
  assert.equal(f("otra-clinica").cajaPinHash, HASH);
  assert.equal(estado.updateMany.length, 0);
});

test("un id que no existe: 404", async () => {
  assert.equal((await RESET("no-existe")).status, 404);
});

test("sin sesión: 401", async () => {
  estado.sesion = null;
  assert.equal((await RESET("doc")).status, 401);
  assert.equal(f("doc").cajaPinHash, HASH);
});

test("sin action «reset» en el cuerpo: 400", async () => {
  assert.equal((await RESET("doc", {})).status, 400);
  assert.equal((await RESET("doc", { action: "borrar" })).status, 400);
  assert.equal(f("doc").cajaPinHash, HASH);
});

test("un id importado que no es uuid se acepta (no hay regex de uuid)", async () => {
  const r = await RESET("imp_000123");
  assert.equal(r.status, 200);
  assert.equal(f("imp_000123").cajaPinHash, null);
});

test("quien aún no tenía PIN: ok, teniaPin:false y sin movimiento", async () => {
  const r = await RESET("recep");
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.teniaPin, false);
  assert.equal(estado.updateMany.length, 0);
  assert.equal(estado.bitacora.length, 0);
});

test("la respuesta del restablecimiento no trae ningún PIN ni hash", async () => {
  const r = await RESET("doc");
  const texto = await r.text();
  assert.ok(!/pin\"?\s*:\s*\"\d/i.test(texto));
  assert.ok(!texto.includes("$2b$"));
});

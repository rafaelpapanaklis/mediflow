/**
 * Equipo — cambiar el correo (y la cédula) de un miembro SIN cuenta de acceso.
 *
 * `npm run test:team-sin-cuenta`
 *
 * El caso real (BEVADENT, 28-sep-2026): el reinicio de la clínica borró la
 * cuenta de Auth de una doctora y dejó su fila en `users` con un correo de
 * relleno. Al editarla, PATCH /api/team/[id] llamaba a updateUserById con un id
 * muerto, Supabase contestaba `user_not_found` y TODO el guardado (correo Y
 * cédula, que viajan juntos) moría con «No se pudo actualizar el correo de
 * acceso. No se guardó ningún cambio.».
 *
 * Aquí se ejecutan los route handlers DE VERDAD. Dobles: la sesión, Prisma, la
 * bitácora, el caché y el cliente de administración de Supabase. Los errores de
 * Supabase tienen la forma real de `AuthApiError` ({ status, code, message }).
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { clasificarErrorAuth, esCorreoMarcador, esUuid } from "../auth-errors";

const CL = "cl-bevadent";
const CL_OTRA = "cl-otra";
// UUID reales: supabase-js exige UUID y lanza con cualquier otra cosa (ver esUuid).
const SB_DOC = "26e82327-e7f4-4d26-a671-902901627219";
const SB_NUEVO = "33333333-3333-4333-8333-333333333333";
const MARCADOR = "johnnifer.desactivada.doc1@invalid.dalecontrol";

interface Fila {
  id: string;
  clinicId: string;
  supabaseId: string;
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  cedulaProfesional: string | null;
}

const errAuth = {
  noExiste: { name: "AuthApiError", status: 404, code: "user_not_found", message: "User not found" },
  yaExiste: { name: "AuthApiError", status: 422, code: "email_exists", message: "A user with this email address has already been registered" },
  invalido: { name: "AuthApiError", status: 400, code: "email_address_invalid", message: "Email address is invalid" },
  limite: { name: "AuthApiError", status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" },
  caido: { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Database error" },
};

const estado = {
  sesion: null as any,
  filas: [] as Fila[],
  updateFalla: false,
  deleteFalla: false,
  authUpdate: [] as any[],
  authUpdateRespuestas: [] as any[], // una por llamada; si se acaba, {error:null}
  authCreate: [] as any[],
  authCreateRespuesta: null as any,
  authDelete: [] as string[],
  authDeleteRespuesta: { error: null } as any,
  bitacora: [] as any[],
  marcadas: [] as string[],
  updates: [] as any[],
  relinkFalla: false,
};

function fila(over: Partial<Fila> = {}): Fila {
  return {
    id: "doc1", clinicId: CL, supabaseId: SB_DOC, role: "DOCTOR", email: MARCADOR,
    firstName: "Johnnifer", lastName: "Benitez", isActive: true, cedulaProfesional: null, ...over,
  };
}

function coincide(f: Fila, where: any): boolean {
  if (!where) return true;
  if (where.id !== undefined && typeof where.id === "string" && f.id !== where.id) return false;
  if (where.id?.in && !where.id.in.includes(f.id)) return false;
  if (where.clinicId !== undefined && typeof where.clinicId === "string" && f.clinicId !== where.clinicId) return false;
  if (where.clinicId?.in && !where.clinicId.in.includes(f.clinicId)) return false;
  if (typeof where.supabaseId === "string" && f.supabaseId !== where.supabaseId) return false;
  if (where.supabaseId?.not !== undefined && f.supabaseId === where.supabaseId.not) return false;
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
      if (estado.updateFalla) throw new Error("boom");
      const f = estado.filas.find((x) => x.id === where.id)!;
      Object.assign(f, data);
      estado.updates.push({ where, data });
      return { ...f, totpSecret: "SECRETO" };
    },
    updateMany: async ({ where, data }: any) => {
      if (estado.relinkFalla && data.supabaseId) throw new Error("boom relink");
      const hit = estado.filas.filter((x) => coincide(x, where));
      hit.forEach((f) => Object.assign(f, data));
      estado.updates.push({ where, data, many: true });
      return { count: hit.length };
    },
    deleteMany: async ({ where }: any) => {
      if (estado.deleteFalla) {
        throw Object.assign(new Error('Foreign key constraint failed on the field: `audit_logs_userId_fkey`'), { code: "P2003" });
      }
      const antes = estado.filas.length;
      estado.filas = estado.filas.filter((x) => !coincide(x, where));
      return { count: antes - estado.filas.length };
    },
  },
  clinic: { findUnique: async () => ({}) },
  $transaction: async (fn: any) => fn(prismaDoble),
};

const adminDoble = {
  auth: {
    admin: {
      updateUserById: async (id: string, attrs: any) => {
        estado.authUpdate.push({ id, attrs });
        return estado.authUpdateRespuestas.shift() ?? { data: {}, error: null };
      },
      createUser: async (attrs: any) => {
        estado.authCreate.push(attrs);
        return estado.authCreateRespuesta ?? { data: { user: { id: SB_NUEVO } }, error: null };
      },
      deleteUser: async (id: string) => {
        estado.authDelete.push(id);
        return estado.authDeleteRespuesta;
      },
    },
  },
};

function sesion(role = "SUPER_ADMIN") {
  return {
    userId: "us-dueno", clinicId: CL, role, permissionsOverride: [],
    clinic: { timezone: "America/Mexico_City", category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN", isAdmin: role === "SUPER_ADMIN" || role === "ADMIN",
  };
}

let PATCH: (id: string, body: unknown) => Promise<Response>;
let DELETE: (id: string) => Promise<Response>;
let RESET: (id: string) => Promise<Response>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  // Por la ruta RESUELTA (la del require de la ruta): el especificador pelado se
  // resolvería aquí por la condición "import" y apuntaría a otro archivo del
  // paquete, así que el doble no entraría y la ruta hablaría con el cliente real.
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
  // plans.ts arrastra "server-only" (no existe en Node pelado); estas pruebas no
  // reactivan a nadie, así que el tope de usuarios no entra en juego.
  mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: null }) } });
  mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
  mock.module("@/lib/auth/must-change-password", {
    namedExports: { markMustChangePassword: async (id: string) => { estado.marcadas.push(id); } },
  });

  const { NextRequest } = await import("next/server");
  const ruta = await import("@/app/api/team/[id]/route");
  const reset = await import("@/app/api/team/[id]/reset-password/route");
  const req = (metodo: string, id: string, body?: unknown) =>
    new NextRequest(`http://app.test/api/team/${id}`, {
      method: metodo,
      headers: { "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  PATCH = (id, body) => ruta.PATCH(req("PATCH", id, body), { params: { id } });
  DELETE = (id) => ruta.DELETE(req("DELETE", id), { params: { id } });
  RESET = (id) => reset.POST(req("POST", `${id}/reset-password`), { params: { id } });
});

beforeEach(() => {
  Object.assign(estado, {
    sesion: sesion(),
    filas: [fila(), fila({ id: "us-dueno", role: "SUPER_ADMIN", supabaseId: "11111111-1111-4111-8111-111111111111", email: "bevadent@outlook.com" }),
      fila({ id: "ajeno", clinicId: CL_OTRA, supabaseId: "22222222-2222-4222-8222-222222222222", email: "otro@x.com" })],
    updateFalla: false, deleteFalla: false, relinkFalla: false,
    authUpdate: [], authUpdateRespuestas: [], authCreate: [], authCreateRespuesta: null,
    authDelete: [], authDeleteRespuesta: { error: null }, bitacora: [], marcadas: [], updates: [],
  });
});

/* ── el clasificador ────────────────────────────────────────────────── */

test("clasificarErrorAuth: reconoce cada causa por su código real de Supabase", () => {
  assert.equal(clasificarErrorAuth(errAuth.noExiste), "cuenta-no-existe");
  assert.equal(clasificarErrorAuth({ status: 404, message: "algo" }), "cuenta-no-existe");
  assert.equal(clasificarErrorAuth(errAuth.yaExiste), "correo-ya-registrado");
  assert.equal(clasificarErrorAuth(errAuth.invalido), "correo-invalido");
  assert.equal(clasificarErrorAuth(errAuth.limite), "limite");
  assert.equal(clasificarErrorAuth(errAuth.caido), "otro");
  assert.equal(clasificarErrorAuth(null), "otro");
});

test("esCorreoMarcador: solo el relleno del reinicio", () => {
  assert.equal(esCorreoMarcador(MARCADOR), true);
  assert.equal(esCorreoMarcador("  X@INVALID.DALECONTROL "), true);
  assert.equal(esCorreoMarcador("johnnifer@gmail.com"), false);
  assert.equal(esCorreoMarcador(null), false);
});

/* ── PATCH: el bug ──────────────────────────────────────────────────── */

test("🔴 BEVADENT: correo nuevo + cédula en un miembro sin cuenta de acceso → se guardan los dos, y se avisa", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  const r = await PATCH("doc1", { email: "Johnnifer@Gmail.com ", cedulaProfesional: "2747272", firstName: "Johnnifer" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sinCuentaDeAcceso, true);
  assert.equal(j.emailChanged, true);
  assert.match(j.aviso, /no tiene una cuenta para iniciar sesión/);
  assert.match(j.aviso, /Restablecer contraseña/);
  const f = estado.filas.find((x) => x.id === "doc1")!;
  assert.equal(f.email, "johnnifer@gmail.com");
  assert.equal(f.cedulaProfesional, "2747272");
  assert.equal("totpSecret" in j, false, "la fila entera no sale al navegador (EQ-05)");
  assert.equal(estado.authUpdate.length, 1, "solo el intento que descubrió que no hay cuenta");
});

test("un fallo de Prisma en un miembro sin cuenta NO intenta 'revertir' una cuenta que nunca se tocó", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  estado.updateFalla = true;
  const r = await PATCH("doc1", { email: "johnnifer@gmail.com" });
  assert.equal(r.status, 500);
  assert.equal(estado.authUpdate.length, 1, "sin segunda llamada de reversión");
});

test("con cuenta viva: el correo cambia en Auth, y si Prisma truena se revierte", async () => {
  estado.updateFalla = true;
  const r = await PATCH("doc1", { email: "johnnifer@gmail.com" });
  assert.equal(r.status, 500);
  assert.equal(estado.authUpdate.length, 2);
  assert.deepEqual(estado.authUpdate[1].attrs, { email: MARCADOR, email_confirm: true });
});

test("con cuenta viva y todo bien: sinCuentaDeAcceso es false y no hay aviso", async () => {
  const r = await PATCH("doc1", { email: "johnnifer@gmail.com", cedulaProfesional: "123" });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.sinCuentaDeAcceso, false);
  assert.equal(j.aviso, undefined);
  assert.equal(j.emailChanged, true);
});

test("la cédula sola (correo intacto, aunque sea el de relleno) se guarda sin llamar a Auth", async () => {
  const r = await PATCH("doc1", { email: MARCADOR, cedulaProfesional: "2747272" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).emailChanged, false);
  assert.equal(estado.authUpdate.length, 0);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.cedulaProfesional, "2747272");
});

/* ── PATCH: cada causa dice lo que es ───────────────────────────────── */

test("correo de otra cuenta → 400 y el mensaje de siempre", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.yaExiste }];
  const r = await PATCH("doc1", { email: "otra@x.com", cedulaProfesional: "1" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ya tiene cuenta en DaleControl/);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.cedulaProfesional, null, "nada se guardó");
});

test("correo que Supabase rechaza → 400 que dice que es el correo", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.invalido }];
  const r = await PATCH("doc1", { email: "a@b.co" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /no aceptó ese correo/);
});

test("límite de Supabase → 429 con 'espera unos minutos'", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.limite }];
  const r = await PATCH("doc1", { email: "a@b.co" });
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /Espera unos minutos/);
});

test("fallo desconocido → el mensaje trae el motivo y dice cómo guardar la cédula sin el correo", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.caido }];
  const r = await PATCH("doc1", { email: "a@b.co", cedulaProfesional: "1" });
  assert.equal(r.status, 502);
  const { error } = await r.json();
  assert.match(error, /motivo: unexpected_failure/);
  assert.match(error, /deja el correo como estaba/);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.cedulaProfesional, null);
});

test("🔴 supabaseId que no es UUID (demo / muestra de QA): sin cuenta, y NO se le pregunta a Auth (supabase-js lanzaría)", async () => {
  estado.filas[0].supabaseId = "sin-acceso-qa_doc_mariana";
  const r = await PATCH("doc1", { email: "mariana@gmail.com", cedulaProfesional: "9" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sinCuentaDeAcceso, true);
  assert.equal(estado.authUpdate.length, 0);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.email, "mariana@gmail.com");
});

test("supabaseId que no es UUID: borrar al miembro no llama a Auth, y restablecer pide el correo real", async () => {
  estado.filas[0].supabaseId = "demo-sb-altabrisa-doctor-1";
  assert.equal((await (await DELETE("doc1")).json()).deleted, true);
  assert.deepEqual(estado.authDelete, []);
  estado.filas.push(fila({ supabaseId: "demo-sb-altabrisa-doctor-1" }));
  assert.equal((await RESET("doc1")).status, 400);
  assert.equal(estado.authUpdate.length, 0);
});

test("esUuid", () => {
  assert.equal(esUuid("26e82327-e7f4-4d26-a671-902901627219"), true);
  assert.equal(esUuid("sin-acceso-qa_doc_mariana"), false);
  assert.equal(esUuid(""), false);
});

test("tenant: un miembro de otra clínica es 404 y no se toca Auth", async () => {
  const r = await PATCH("ajeno", { email: "x@y.co" });
  assert.equal(r.status, 404);
  assert.equal(estado.authUpdate.length, 0);
});

/* ── DELETE ─────────────────────────────────────────────────────────── */

test("🔴 DELETE de quien tiene filas en la bitácora: se desactiva, NO se le borra la cuenta de Auth, y no truena", async () => {
  estado.deleteFalla = true;
  estado.filas[0].isActive = true;
  const r = await DELETE("doc1");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).deactivated, true);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.isActive, false);
  assert.deepEqual(estado.authDelete, []);
});

test("DELETE limpio: borra la fila y DESPUÉS la cuenta de Auth", async () => {
  const r = await DELETE("doc1");
  assert.equal((await r.json()).deleted, true);
  assert.equal(estado.filas.some((x) => x.id === "doc1"), false);
  assert.deepEqual(estado.authDelete, [SB_DOC]);
});

test("DELETE de una sede: si la persona sigue en otra clínica, su cuenta de Auth se respeta", async () => {
  estado.filas.push(fila({ id: "doc1-sede2", clinicId: CL_OTRA, supabaseId: SB_DOC }));
  const r = await DELETE("doc1");
  assert.equal((await r.json()).deleted, true);
  assert.deepEqual(estado.authDelete, []);
});

test("DELETE de un miembro sin cuenta: que Auth diga 'no existe' no es un error", async () => {
  estado.authDeleteRespuesta = { error: errAuth.noExiste };
  const r = await DELETE("doc1");
  assert.equal(r.status, 200);
});

/* ── reset-password: darle acceso a quien no lo tiene ───────────────── */

test("🔴 restablecer a un miembro sin cuenta con correo real: se le CREA la cuenta y la fila se enlaza", async () => {
  estado.filas[0].email = "johnnifer@gmail.com";
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  const r = await RESET("doc1");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.cuentaCreada, true);
  assert.equal(typeof j.tempPassword, "string");
  assert.match(j.aviso, /no tenía cuenta de acceso/);
  assert.equal(estado.authCreate.length, 1);
  assert.equal(estado.authCreate[0].email, "johnnifer@gmail.com");
  assert.equal(estado.authCreate[0].email_confirm, true);
  assert.equal(estado.authCreate[0].password, j.tempPassword);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.supabaseId, SB_NUEVO);
  assert.deepEqual(estado.marcadas, [SB_NUEVO], "debe cambiar la contraseña al entrar");
});

test("restablecer a un miembro sin cuenta cuyo correo es el de relleno: 400 que pide el correo real, y no se crea nada", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  const r = await RESET("doc1");
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "SIN_CUENTA_SIN_CORREO");
  assert.equal(estado.authCreate.length, 0);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.supabaseId, SB_DOC);
});

test("crear la cuenta con un correo que ya es de otra persona: 400 claro y la fila sigue igual", async () => {
  estado.filas[0].email = "ocupado@x.com";
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  estado.authCreateRespuesta = { data: { user: null }, error: errAuth.yaExiste };
  const r = await RESET("doc1");
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ya tiene cuenta/);
  assert.equal(estado.filas.find((x) => x.id === "doc1")!.supabaseId, SB_DOC);
});

test("si no se puede enlazar la cuenta recién creada, se borra para no dejar el correo ocupado", async () => {
  estado.filas[0].email = "johnnifer@gmail.com";
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  estado.relinkFalla = true;
  const r = await RESET("doc1");
  assert.equal(r.status, 500);
  assert.deepEqual(estado.authDelete, [SB_NUEVO]);
  assert.deepEqual(estado.marcadas, []);
});

test("restablecer a quien SÍ tiene cuenta sigue siendo solo cambiar la contraseña", async () => {
  const r = await RESET("doc1");
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.cuentaCreada, false);
  assert.equal(estado.authCreate.length, 0);
  assert.deepEqual(estado.marcadas, [SB_DOC]);
});

test("restablecer: un ADMIN (no SUPER_ADMIN) sigue sin poder", async () => {
  estado.sesion = sesion("ADMIN");
  const r = await RESET("doc1");
  assert.equal(r.status, 403);
  assert.equal(estado.authUpdate.length, 0);
});

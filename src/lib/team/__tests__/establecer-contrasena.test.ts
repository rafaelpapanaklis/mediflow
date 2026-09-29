/**
 * Equipo — «Establecer contraseña nueva» (ws1-t4).
 *
 * `npm run test:team-establecer-contrasena`
 *
 * El dueño (SUPER_ADMIN) escribe la contraseña de un doctor o recepcionista y
 * desde ese momento el miembro entra con ella. Se ejecuta el route handler DE
 * VERDAD (POST /api/team/[id]/set-password) con dobles de la sesión, Prisma, la
 * bitácora y el cliente de administración de Supabase. También se vuelve a
 * pasar por Restablecer, que ahora comparte el helper de la cuenta de acceso.
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { validarContrasenaNueva, ERRORES_CONTRASENA } from "../contrasena-nueva";

const CL = "cl-prueba";
const CL_OTRA = "cl-otra";
const SB_DOC = "26e82327-e7f4-4d26-a671-902901627219";
const SB_DUENO = "11111111-1111-4111-8111-111111111111";
const SB_NUEVO = "33333333-3333-4333-8333-333333333333";
const CLAVE = "Sonrisa2026";

interface Fila {
  id: string; clinicId: string; supabaseId: string; role: string; email: string;
  firstName: string; lastName: string; isActive: boolean; mustChangePassword?: boolean;
}

const estado = {
  sesion: null as any,
  filas: [] as Fila[],
  authUpdate: [] as any[],
  authUpdateRespuestas: [] as any[],
  authCreate: [] as any[],
  authCreateRespuesta: null as any,
  authDelete: [] as string[],
  bitacora: [] as any[],
  marcadas: [] as string[],
  limpiadas: [] as string[],
  consultas: [] as any[],
  consola: [] as string[],
};

function fila(over: Partial<Fila> = {}): Fila {
  return {
    id: "doc1", clinicId: CL, supabaseId: SB_DOC, role: "DOCTOR", email: "ana@clinica.mx",
    firstName: "Ana", lastName: "Pérez", isActive: true, ...over,
  };
}

function coincide(f: Fila, where: any): boolean {
  if (!where) return true;
  if (typeof where.id === "string" && f.id !== where.id) return false;
  if (typeof where.clinicId === "string" && f.clinicId !== where.clinicId) return false;
  if (typeof where.supabaseId === "string" && f.supabaseId !== where.supabaseId) return false;
  return true;
}

const prismaDoble: any = {
  user: {
    findFirst: async (args: any) => {
      estado.consultas.push(args);
      const f = estado.filas.find((x) => coincide(x, args.where));
      return f ? { ...f } : null;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = estado.filas.filter((x) => coincide(x, where));
      hit.forEach((f) => Object.assign(f, data));
      return { count: hit.length };
    },
  },
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
      deleteUser: async (id: string) => { estado.authDelete.push(id); return { error: null }; },
    },
  },
};

function sesion(role = "SUPER_ADMIN", over: Record<string, unknown> = {}) {
  return {
    userId: "us-dueno", clinicId: CL, role, permissionsOverride: [],
    isSuperAdmin: role === "SUPER_ADMIN", isAdmin: role === "SUPER_ADMIN" || role === "ADMIN", ...over,
  };
}

let SET: (id: string, body: unknown) => Promise<Response>;
let RESET: (id: string) => Promise<Response>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module(require.resolve("@supabase/supabase-js"), { namedExports: { createClient: () => adminDoble } });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => estado.sesion } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", {
    namedExports: { ...auditReal, logAudit: async (o: any) => { estado.bitacora.push(o); } },
  });
  mock.module("@/lib/auth/must-change-password", {
    namedExports: {
      markMustChangePassword: async (id: string) => { estado.marcadas.push(id); },
      clearMustChangePassword: async (id: string) => { estado.limpiadas.push(id); },
    },
  });

  // Todo lo que la ruta escriba en consola se captura: la contraseña no puede aparecer.
  for (const k of ["log", "error", "warn", "info"] as const) {
    const orig = console[k];
    console[k] = (...a: unknown[]) => { estado.consola.push(a.map((v) => JSON.stringify(v) ?? String(v)).join(" ")); void orig; };
  }

  const { NextRequest } = await import("next/server");
  const set = await import("@/app/api/team/[id]/set-password/route");
  const reset = await import("@/app/api/team/[id]/reset-password/route");
  SET = (id, body) =>
    set.POST(new NextRequest(`http://app.test/api/team/${id}/set-password`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }), { params: { id } });
  RESET = (id) =>
    reset.POST(new NextRequest(`http://app.test/api/team/${id}/reset-password`, { method: "POST" }), { params: { id } });
});

beforeEach(() => {
  Object.assign(estado, {
    sesion: sesion(),
    filas: [
      fila(),
      fila({ id: "rec1", role: "RECEPTIONIST", supabaseId: "44444444-4444-4444-8444-444444444444", email: "luis@clinica.mx", firstName: "Luis", lastName: "Gómez" }),
      fila({ id: "us-dueno", role: "SUPER_ADMIN", supabaseId: SB_DUENO, email: "dueno@clinica.mx", firstName: "Rafael", lastName: "Dueño" }),
      fila({ id: "otro-dueno", role: "SUPER_ADMIN", supabaseId: "55555555-5555-4555-8555-555555555555", email: "socia@clinica.mx" }),
      fila({ id: "ajeno", clinicId: CL_OTRA, supabaseId: "22222222-2222-4222-8222-222222222222", email: "otro@x.com" }),
    ],
    authUpdate: [], authUpdateRespuestas: [], authCreate: [], authCreateRespuesta: null, authDelete: [],
    bitacora: [], marcadas: [], limpiadas: [], consultas: [], consola: [],
  });
});

const errAuth = {
  noExiste: { name: "AuthApiError", status: 404, code: "user_not_found", message: "User not found" },
  yaExiste: { name: "AuthApiError", status: 422, code: "email_exists", message: "A user with this email address has already been registered" },
  debil: { name: "AuthWeakPasswordError", status: 422, code: "weak_password", message: "Password is known to be weak and easy to guess" },
  caido: { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Database error" },
};

function nadaTocado() {
  assert.equal(estado.authUpdate.length, 0, "no se habló con Supabase");
  assert.equal(estado.authCreate.length, 0);
  assert.equal(estado.bitacora.length, 0, "sin rastro de algo que no pasó");
}

/* ── la regla, pura ─────────────────────────────────────────────────── */

test("validarContrasenaNueva: mínimo 8, letras y números, sin espacios en los bordes, confirmación igual", () => {
  assert.equal(validarContrasenaNueva(CLAVE, CLAVE), null);
  assert.equal(validarContrasenaNueva("ñandú2026"), null, "letras con acento cuentan como letras");
  assert.equal(validarContrasenaNueva(""), ERRORES_CONTRASENA.vacia);
  assert.equal(validarContrasenaNueva(undefined), ERRORES_CONTRASENA.vacia);
  assert.equal(validarContrasenaNueva(12345678), ERRORES_CONTRASENA.vacia);
  assert.equal(validarContrasenaNueva("abc1234"), ERRORES_CONTRASENA.corta);
  assert.equal(validarContrasenaNueva("abcdefgh"), ERRORES_CONTRASENA.sinNumero);
  assert.equal(validarContrasenaNueva("12345678"), ERRORES_CONTRASENA.sinLetra);
  assert.equal(validarContrasenaNueva(" Sonrisa2026"), ERRORES_CONTRASENA.espacios);
  assert.equal(validarContrasenaNueva("Sonrisa2026 "), ERRORES_CONTRASENA.espacios);
  assert.equal(validarContrasenaNueva("a1".repeat(40)), ERRORES_CONTRASENA.larga);
  assert.equal(validarContrasenaNueva(CLAVE, "Sonrisa2027"), ERRORES_CONTRASENA.noCoincide);
});

/* ── el caso feliz ──────────────────────────────────────────────────── */

test("🟢 el dueño pone una contraseña nueva a una doctora: Supabase la recibe, sin temporal pendiente, y responde el mensaje de Rafael", async () => {
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.success, true);
  assert.equal(j.mensaje, "Contraseña actualizada: ya puede entrar con ella.");
  assert.equal(j.cuentaCreada, false);
  assert.deepEqual(estado.authUpdate, [{ id: SB_DOC, attrs: { password: CLAVE } }]);
  assert.deepEqual(estado.limpiadas, [SB_DOC], "si quedaba una temporal, ya no se le exige cambiarla");
  assert.deepEqual(estado.marcadas, [], "la del dueño NO se marca como temporal");
  assert.equal(JSON.stringify(j).includes(CLAVE), false, "la contraseña no vuelve al navegador");
});

test("también a recepción", async () => {
  const r = await SET("rec1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 200);
  assert.equal(estado.authUpdate[0].id, "44444444-4444-4444-8444-444444444444");
});

/* ── solo el dueño ──────────────────────────────────────────────────── */

test("🔴 ADMIN, DOCTOR o recepción no pueden: 403 y nada se toca", async () => {
  for (const rol of ["ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"]) {
    estado.sesion = sesion(rol);
    const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
    assert.equal(r.status, 403, rol);
  }
  nadaTocado();
});

test("sin sesión: 401", async () => {
  estado.sesion = null;
  assert.equal((await SET("doc1", { password: CLAVE, confirmacion: CLAVE })).status, 401);
  nadaTocado();
});

test("🔴 nunca sobre sí mismo (aunque mande una contraseña válida)", async () => {
  const r = await SET("us-dueno", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Configuración → Seguridad/);
  nadaTocado();
});

test("🔴 nunca sobre otro dueño (SUPER_ADMIN)", async () => {
  const r = await SET("otro-dueno", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /otro dueño/);
  nadaTocado();
});

test("🔴 nunca sobre un miembro de OTRA clínica: 404, y la búsqueda va con el clinicId de la sesión", async () => {
  const r = await SET("ajeno", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 404);
  nadaTocado();
  assert.equal(estado.consultas[0].where.clinicId, CL);
});

test("sesión sin clínica: corta antes de consultar (clinicId undefined no filtra nada)", async () => {
  estado.sesion = sesion("SUPER_ADMIN", { clinicId: undefined });
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  assert.equal(estado.consultas.length, 0);
  nadaTocado();
});

test("un miembro desactivado no recibe contraseña", async () => {
  estado.filas[0].isActive = false;
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /desactivado/);
  nadaTocado();
});

/* ── validación en el servidor ──────────────────────────────────────── */

test("🔴 el servidor valida igual que el cliente: corta, sin número, sin letra, no coincide, vacía, cuerpo roto", async () => {
  const casos: Array<[unknown, string]> = [
    [{ password: "abc123", confirmacion: "abc123" }, ERRORES_CONTRASENA.corta],
    [{ password: "abcdefgh", confirmacion: "abcdefgh" }, ERRORES_CONTRASENA.sinNumero],
    [{ password: "12345678", confirmacion: "12345678" }, ERRORES_CONTRASENA.sinLetra],
    [{ password: CLAVE, confirmacion: "otra2026x" }, ERRORES_CONTRASENA.noCoincide],
    [{}, ERRORES_CONTRASENA.vacia],
    ["no-es-json", ERRORES_CONTRASENA.vacia],
  ];
  for (const [body, esperado] of casos) {
    const r = await SET("doc1", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    const j = await r.json();
    assert.equal(j.error, esperado);
    assert.equal(j.code, "CONTRASENA_INVALIDA");
  }
  nadaTocado();
});

test("si Supabase la rechaza por débil, se dice en español y no se registra nada", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.debil }];
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, "CONTRASENA_DEBIL");
  assert.match(j.error, /débil/);
  assert.equal(estado.bitacora.length, 0);
  assert.deepEqual(estado.limpiadas, []);
});

test("Supabase caído: 500, sin rastro ni marca", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.caido }];
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 500);
  assert.equal(estado.bitacora.length, 0);
  assert.deepEqual(estado.limpiadas, []);
});

/* ── crea la cuenta si falta ────────────────────────────────────────── */

test("🟢 el miembro no tiene cuenta de acceso (id muerto): se le CREA con su correo y esa contraseña, y la fila se enlaza", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.cuentaCreada, true);
  assert.match(j.aviso, /se le creó una con el correo ana@clinica\.mx/);
  assert.deepEqual(estado.authCreate, [{ email: "ana@clinica.mx", password: CLAVE, email_confirm: true }]);
  assert.equal(estado.filas.find((f) => f.id === "doc1")!.supabaseId, SB_NUEVO);
  assert.deepEqual(estado.limpiadas, [SB_NUEVO]);
  assert.deepEqual(estado.bitacora[0].changes.cuentaDeAccesoCreada, { before: false, after: true });
});

test("supabaseId que ni es UUID (demo): no se pregunta a Auth, se crea directo", async () => {
  estado.filas[0].supabaseId = "demo-sb-doc1";
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 200);
  assert.equal(estado.authUpdate.length, 0);
  assert.equal(estado.authCreate.length, 1);
});

test("sin cuenta y con correo de relleno: no se crea nada y se explica qué pulsar", async () => {
  estado.filas[0].email = "ana.desactivada.doc1@invalid.dalecontrol";
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, "SIN_CUENTA_SIN_CORREO");
  assert.match(j.error, /«Establecer contraseña nueva»/);
  assert.equal(estado.authCreate.length, 0);
  assert.equal(estado.bitacora.length, 0);
});

test("sin cuenta y el correo ya es de otra cuenta: 400 claro", async () => {
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  estado.authCreateRespuesta = { data: { user: null }, error: errAuth.yaExiste };
  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ya tiene cuenta/);
});

/* ── el rastro ──────────────────────────────────────────────────────── */

test("🟢 rastro «X estableció una contraseña nueva para Y» — y la contraseña NO aparece en la bitácora ni en consola", async () => {
  // Un fallo de Auth también pasa por console.error: tampoco ahí puede salir.
  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.caido }];
  await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  estado.bitacora = [];

  const r = await SET("doc1", { password: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 200);
  assert.equal(estado.bitacora.length, 1);
  const b = estado.bitacora[0];
  assert.equal(b.action, "password_set");
  assert.equal(b.entityType, "user");
  assert.equal(b.entityId, "doc1");
  assert.equal(b.clinicId, CL);
  assert.equal(b.userId, "us-dueno");
  assert.equal(b.changes.descripcion.after, "Rafael Dueño estableció una contraseña nueva para Ana Pérez");
  const todo = JSON.stringify(estado.bitacora) + estado.consola.join("\n");
  assert.equal(todo.includes(CLAVE), false, "la contraseña se coló en el rastro");
  assert.equal(/password|contrasena"\s*:/i.test(JSON.stringify(b.changes)), false, "ningún campo de contraseña en changes");
});

test("la acción nueva se lee en la bitácora: etiqueta en español y en el filtro", async () => {
  const core = await import("@/lib/admin/audit-core");
  assert.equal(core.actionMeta("password_set").label, "Contraseña nueva");
  assert.ok((core.AUDIT_ACTION_OPTIONS as readonly string[]).includes("password_set"));
});

/* ── Restablecer sigue igual (comparte el helper) ───────────────────── */

test("Restablecer: temporal de 12, se marca como temporal, y sin cuenta la crea — igual que antes", async () => {
  let r = await RESET("doc1");
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.tempPassword.length, 12);
  assert.deepEqual(estado.marcadas, [SB_DOC]);
  assert.equal(estado.bitacora[0].action, "password_reset");

  estado.authUpdateRespuestas = [{ data: {}, error: errAuth.noExiste }];
  r = await RESET("rec1");
  j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.cuentaCreada, true);

  estado.filas[0].email = "x@invalid.dalecontrol";
  estado.filas[0].supabaseId = "demo-sb";
  r = await RESET("doc1");
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /«Restablecer contraseña»/);
});

/* ── la pantalla ────────────────────────────────────────────────────── */

test("Equipo: el botón solo se ofrece al dueño, nunca sobre otro dueño ni sobre sí mismo, y valida con la misma función", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/dashboard/team/team-client.tsx"), "utf8");
  assert.match(src, /onSetPassword=\{\s*isSuperAdmin && editMember\.role !== "SUPER_ADMIN" && editMember\.id !== currentUserId/);
  assert.match(src, /validarContrasenaNueva\(nueva, confirmacion\)/);
  assert.match(src, /autoComplete="new-password"/);
  assert.match(src, /\/set-password`/);
  assert.equal(/console\.(log|error|warn)\([^)]*(nueva|contrasena)/.test(src), false);
});

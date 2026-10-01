/**
 * ws1-t8 · M1 — el 2FA se exige en TODA sesión de clínica, no solo en /api.
 *
 * Run: npm run test:2fa-toda-sesion
 *
 * El hallazgo (auditoría del 30-sep-2026): el gate de getAuthContext y
 * getCurrentUser decidía por el x-pathname y solo cortaba rutas /api. Una
 * SERVER ACTION es un POST a /dashboard/..., así que las ~176 actions de
 * src/app/actions pasaban con solo la contraseña (borrando la cookie
 * df_2fa_pending, que es del cliente). Y el odontograma y /api/clinic/geocode
 * resolvían la sesión con su propio getUser + prisma, sin gate ninguno.
 *
 * Dos mitades:
 *   1. Con getAuthContext / getCurrentUser REALES (Prisma, Supabase, cookies y
 *      cabeceras de mentira): bloquean en server action, en página y sin
 *      ruta; la única salida es getCurrentUserSinDosPasos; nadie queda
 *      obligado por su ROL (el 2FA es opcional, decisión de Rafael del
 *      1-oct-2026); «Ver como clínica» pasa.
 *   2. Un ESCANEO del código que falla si alguien vuelve a resolver la sesión
 *      de clínica por su cuenta (supabase.auth.getUser fuera de la lista
 *      justificada) o usa las salidas sin gate fuera de donde toca.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SB = "sb_persona";

interface Fila {
  id: string;
  supabaseId: string;
  clinicId: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: Date;
  permissionsOverride: string[];
  clinic: { id: string; category: string; require2fa: boolean };
}

function fila(extra: Partial<Fila> = {}): Fila {
  return {
    id: "u_a",
    supabaseId: SB,
    clinicId: "cli_a",
    role: "DOCTOR",
    isActive: true,
    totpEnabled: false,
    createdAt: new Date("2025-01-01"),
    permissionsOverride: [],
    clinic: { id: "cli_a", category: "DENTAL", require2fa: false },
    ...extra,
  };
}

let filas: Fila[] = [];
let ruta: string | null = null;
let accion: string | null = null;
let cookie2fa = false;
let cookieVerComo = false;

beforeEach(() => {
  filas = [];
  ruta = null;
  accion = null;
  cookie2fa = false;
  cookieVerComo = false;
});

const prismaFalso = {
  user: {
    findMany: async ({ where }: any) =>
      filas.filter((f) => Object.entries(where ?? {}).every(([k, v]) => (f as any)[k] === v)),
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/supabase/server", {
  namedExports: { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: SB } } }) } }) },
});
mock.module("@/lib/active-clinic", {
  namedExports: { readActiveClinicCookie: () => null, logClinicFallback: () => {}, resembrarActiveClinicCookie: () => false },
});
mock.module("next/headers", {
  namedExports: {
    headers: () => ({
      get: (k: string) => (k === "x-pathname" ? ruta : k === "next-action" ? accion : null),
    }),
  },
});
mock.module("@/lib/plan-status", {
  namedExports: { isPlanExpired: () => false, isApiPathBlockedForExpiredPlan: () => false },
});
mock.module("@/lib/auth/two-factor-cookie", {
  namedExports: {
    hasValidTwoFactorCookie: () => cookie2fa,
    hasValidVerComoCookie: () => cookieVerComo,
  },
});
mock.module("@/lib/auth/two-factor-identity", {
  namedExports: { personaTieneDosFactores: async () => false },
});
class Redireccion extends Error { constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); } }
mock.module("react", { namedExports: { cache: <T>(f: T) => f } });
mock.module("next/navigation", { namedExports: { redirect: (d: string) => { throw new Redireccion(d); } } });

const getAuthContext = async () => (await import("@/lib/auth-context")).getAuthContext();
const getCurrentUser = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUser();
const getCurrentUserSinDosPasos = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUserSinDosPasos();

const redirigeA = (destino: string) => (e: unknown) => e instanceof Redireccion && e.destino === destino;

// ══════════════════ 1 · el gate corta en toda sesión ══════════════════

test("SERVER ACTION (POST a /dashboard/...) con 2FA pendiente: getAuthContext no da contexto", async () => {
  filas = [fila({ totpEnabled: true })];
  ruta = "/dashboard/patients/p1";
  assert.equal(await getAuthContext(), null, "antes de ws1-t8 esto devolvía el contexto: el hueco M1");
});

test("server action: además de cortar, manda al reto (no un «No autorizado» genérico)", async () => {
  filas = [fila({ totpEnabled: true })];
  ruta = "/dashboard/patients/p1";
  accion = "7f3a…";
  await assert.rejects(() => getAuthContext(), redirigeA("/dashboard/2fa"));
});

test("sin x-pathname (páginas fuera del middleware, llamadas internas) también corta", async () => {
  filas = [fila({ totpEnabled: true })];
  ruta = null;
  assert.equal(await getAuthContext(), null);
});

test("una cabecera x-pathname inventada hacia /api/auth no abre nada", async () => {
  filas = [fila({ totpEnabled: true })];
  ruta = "/api/auth/2fa/verify";
  assert.equal(await getAuthContext(), null, "las salidas van por código, no por la ruta");
});

test("getCurrentUser en una página del panel: al reto, con vuelta a esa página", async () => {
  filas = [fila({ totpEnabled: true })];
  ruta = "/dashboard/agenda";
  await assert.rejects(() => getCurrentUser(), redirigeA("/dashboard/2fa?next=%2Fdashboard%2Fagenda"));
});

test("getCurrentUser con la clínica que exige 2FA y sin enrolar: al enrolamiento", async () => {
  filas = [fila({ clinic: { id: "cli_a", category: "DENTAL", require2fa: true } })];
  ruta = "/dashboard";
  await assert.rejects(() => getCurrentUser(), redirigeA("/dashboard/2fa/setup"));
});

test("la única salida es getCurrentUserSinDosPasos (layout y pantallas del reto)", async () => {
  filas = [fila({ totpEnabled: true })];
  ruta = "/dashboard/2fa";
  const u = await getCurrentUserSinDosPasos();
  assert.equal(u.clinicId, "cli_a");
});

test("con la prueba de 2FA, todo pasa igual que ayer", async () => {
  filas = [fila({ totpEnabled: true })];
  cookie2fa = true;
  ruta = "/dashboard/patients";
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
  assert.equal((await getCurrentUser()).clinicId, "cli_a");
});

test("quien no tiene 2FA en una clínica que no lo exige no se entera del gate", async () => {
  filas = [fila()];
  ruta = "/dashboard/patients";
  accion = "abc";
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
  assert.equal((await getCurrentUser()).clinicId, "cli_a");
});

// ══════════════════ 2FA opcional: ningún rol obligado ══════════════════

test("el DUEÑO sin 2FA entra igual que todos: el 2FA es opcional, no hay obligación por rol", async () => {
  filas = [fila({ role: "SUPER_ADMIN" })];
  ruta = "/dashboard/patients";
  accion = "abc";
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
  assert.equal((await getCurrentUser()).clinicId, "cli_a");
});

test("el dueño que SÍ activó su 2FA tiene el reto como cualquiera", async () => {
  filas = [fila({ role: "SUPER_ADMIN", totpEnabled: true })];
  ruta = "/dashboard";
  await assert.rejects(() => getCurrentUser(), redirigeA("/dashboard/2fa?next=%2Fdashboard"));
});

test("«Ver como clínica» desde /admin: entra aunque el dueño tenga su 2FA activado o la clínica lo exija", async () => {
  filas = [fila({ role: "SUPER_ADMIN", totpEnabled: true })];
  cookieVerComo = true;
  ruta = "/dashboard";
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
  assert.equal((await getCurrentUser()).clinicId, "cli_a");
  filas = [fila({ role: "SUPER_ADMIN", clinic: { id: "cli_a", category: "DENTAL", require2fa: true } })];
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
});

test("la regla: verComo pasa siempre; enrolado sin prueba → reto; require2fa → enrolar; nada más", async () => {
  const { decisionDosPasos } = await import("../two-factor-gate");
  assert.equal(decisionDosPasos({ totpEnabled: true, hasValidCookie: false, verComoAdmin: true }), null);
  assert.equal(decisionDosPasos({ require2fa: true, hasValidCookie: false, verComoAdmin: true }), null);
  assert.equal(decisionDosPasos({ totpEnabled: true, hasValidCookie: false }), "challenge");
  assert.equal(decisionDosPasos({ totpEnabled: true, hasValidCookie: true }), null);
  assert.equal(decisionDosPasos({ require2fa: true, hasValidCookie: false }), "setup");
  assert.equal(decisionDosPasos({ hasValidCookie: false }), null);
});

test("la prueba de «Ver como clínica» y la de 2FA superado no se sustituyen entre sí", async () => {
  const { packTwoFactorToken, isTwoFactorTokenValidFor, verComoSecret } = await import("../two-factor-core");
  const sb = "11111111-2222-3333-4444-555555555555";
  const cli = "clinica_qa_prueba";
  const now = Date.now();
  const verComo = packTwoFactorToken(sb, cli, now, verComoSecret());
  const dosPasos = packTwoFactorToken(sb, cli, now);
  assert.equal(isTwoFactorTokenValidFor(verComo, sb, cli, now, 3600, verComoSecret()), true);
  assert.equal(isTwoFactorTokenValidFor(verComo, sb, cli, now), false, "la de admin no vale como 2FA superado");
  assert.equal(isTwoFactorTokenValidFor(dosPasos, sb, cli, now, 3600, verComoSecret()), false, "un 2FA superado no vale como admin");
  assert.equal(isTwoFactorTokenValidFor(verComo, sb, "otra_clinica", now, 3600, verComoSecret()), false, "atada a la clínica");
});

// ══════════════════ 2 · escaneo: nadie se salta el gate ══════════════════

const SRC = join(__dirname, "../../..");

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "node_modules" || n === "__tests__" || n.startsWith(".")) continue;
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const TODOS = archivos(SRC).map((p) => ({ rel: relative(join(SRC, ".."), p).replace(/\\/g, "/"), src: sinComentarios(readFileSync(p, "utf8")) }));

/**
 * Quién puede leer la sesión de Supabase DIRECTAMENTE (sin getAuthContext ni
 * getCurrentUser), y por qué no hace falta el 2FA de clínica ahí. Añadir una
 * entrada obliga a justificarla aquí; una ruta o action de clínica que haga
 * `supabase.auth.getUser()` por su cuenta hace fallar este test.
 */
const LEEN_LA_SESION_DIRECTO: Record<string, string> = {
  "src/lib/auth-context.ts": "ES el gate (getAuthContext)",
  "src/lib/auth.ts": "ES el gate (getSession/getCurrentUser)",
  "src/lib/auth/two-factor.ts": "getTwoFactorActor: el propio flujo del 2FA (reto, enrolamiento)",
  "src/lib/supabase/middleware.ts": "refresco de la cookie de Supabase en el middleware; no lee datos",
  "src/app/api/auth/post-login/route.ts": "cierre de login: SIEMBRA las cookies del reto",
  "src/app/api/auth/register-oauth/route.ts": "alta de cuenta nueva (aún sin 2FA)",
  "src/app/api/switch-clinic/route.ts": "salida: cambia de sede y re-siembra el reto de la de destino",
  "src/app/api/my-clinics/route.ts": "solo los nombres de las sedes propias (selector de clínica)",
  "src/app/api/google/callback/route.ts": "OAuth de Google: el state firmado lo emite una ruta que ya pasó el gate",
  "src/app/onboarding/page.tsx": "persona SIN clínica todavía: no hay 2FA de clínica que pedir",
  "src/app/api/admin/seed-clinics/route.ts": "herramienta de plataforma atada a un correo; no es sesión de clínica",
  "src/lib/analytics/identity.ts": "solo identifica a la persona para analítica; no sirve datos",
  "src/app/api/afiliados/auth/link/route.ts": "sesión de AFILIADO, otra identidad",
  "src/lib/affiliate-auth.ts": "sesión de AFILIADO",
  "src/lib/affiliates/link-state.ts": "sesión de AFILIADO",
  "src/app/api/instituto/auth/session/route.ts": "vertical instituto (getEduContext)",
  "src/lib/edu-auth.ts": "vertical instituto",
  "src/lib/barber-auth.ts": "vertical barbería",
  "src/lib/realty-auth.ts": "vertical inmuebles",
  "src/lib/lab-auth.ts": "laboratorios (otra identidad)",
  "src/lib/supplier-auth.ts": "proveedores (otra identidad)",
};

test("nadie resuelve la sesión de clínica por su cuenta (supabase.auth.getUser solo donde está justificado)", () => {
  const leen = TODOS.filter((f) => /\.auth\.getUser\s*\(/.test(f.src)).map((f) => f.rel);
  const intrusos = leen.filter((r) => !(r in LEEN_LA_SESION_DIRECTO));
  assert.deepEqual(
    intrusos,
    [],
    "Estos archivos leen la sesión de Supabase sin pasar por getAuthContext/getCurrentUser, y por tanto " +
      "sin el gate de 2FA. Usa getAuthContext() (o justifícalo en LEEN_LA_SESION_DIRECTO).",
  );
});

test("el odontograma y geocode ya no son excepción: delegan en getAuthContext", () => {
  for (const r of ["src/lib/odontogram/api-auth.ts", "src/app/api/clinic/geocode/route.ts"]) {
    const f = TODOS.find((x) => x.rel === r);
    assert.ok(f, r);
    assert.doesNotMatch(f!.src, /\.auth\.getUser\s*\(/, `${r} vuelve a leer la sesión por su cuenta`);
    assert.match(f!.src, /getAuthContext\s*\(/, `${r} no pasa por getAuthContext`);
  }
});

test("getCurrentUserSinDosPasos solo lo usan el layout y las pantallas del propio 2FA", () => {
  const usan = TODOS.filter((f) => /getCurrentUserSinDosPasos\s*\(/.test(f.src)).map((f) => f.rel).sort();
  assert.deepEqual(usan, [
    "src/app/dashboard/2fa/page.tsx",
    "src/app/dashboard/2fa/setup/page.tsx",
    "src/app/dashboard/layout.tsx",
  ]);
});

test("getTwoFactorActor (resolución sin gate) solo vive en las rutas /api/auth/2fa", () => {
  const usan = TODOS.filter((f) => /getTwoFactorActor\s*\(/.test(f.src)).map((f) => f.rel);
  const fuera = usan.filter((r) => r !== "src/lib/auth/two-factor.ts" && !r.startsWith("src/app/api/auth/2fa/"));
  assert.deepEqual(fuera, []);
});

test("el gate autoritativo ya no decide por la ruta (x-pathname) si exigir el 2FA", () => {
  for (const r of ["src/lib/auth-context.ts", "src/lib/auth.ts"]) {
    const f = TODOS.find((x) => x.rel === r)!;
    assert.doesNotMatch(f.src, /isApiPathBlockedForMissingTwoFactor/, `${r} vuelve a limitar el 2FA a /api`);
    assert.match(f.src, /decidirDosPasos\(/, `${r} no usa la decisión común`);
  }
});

test("no queda rastro del 2FA obligatorio para dueños (retirado el 1-oct-2026)", () => {
  const rastro = TODOS.filter((f) =>
    /DOS_PASOS_DUENOS|estadoDuenoDosPasos|df_2fa_simular|df_2fa_luego|2fa\/activar|2fa\/posponer/.test(f.src),
  ).map((f) => f.rel);
  assert.deepEqual(rastro, []);
});

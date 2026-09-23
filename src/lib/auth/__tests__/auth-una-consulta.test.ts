/**
 * ws1-t1 · La sesión de cada /api se resuelve con UNA lectura de `users`.
 *
 * Run: npm run test:auth-una-consulta
 *
 * Antes, getAuthContext y getCurrentUser hacían hasta tres consultas en serie
 * en CADA petición: la fila de la clínica activa (cookie), si fallaba la
 * primera fila por createdAt, y luego «¿alguna hermana tiene 2FA?»
 * (personaTieneDosFactores). Medido el 23-sep-2026 desde el servidor de QA,
 * cada viaje a la base cuesta ~190 ms: el menú tardaba 541 ms con sus datos ya
 * en caché, y era todo autenticación.
 *
 * Ahora es una sola `findMany` de las filas activas de la persona. Lo que no
 * puede cambiar —y es lo que se fija aquí, con getAuthContext y getCurrentUser
 * REALES y solo Prisma, Supabase y las cookies de mentira—:
 *   · la clínica elegida es la de la cookie si la persona está activa ahí;
 *   · si no, la primera por createdAt, NUNCA la de la cookie ajena;
 *   · el 2FA de una hermana obliga igual que antes (EQ-02), fail-closed;
 *   · el supabaseId sale de la sesión y el filtro exige isActive.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

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

function fila(id: string, clinicId: string, createdAt: string, extra: Partial<Fila> = {}): Fila {
  return {
    id,
    supabaseId: SB,
    clinicId,
    role: "ADMIN",
    isActive: true,
    totpEnabled: false,
    createdAt: new Date(createdAt),
    permissionsOverride: [],
    clinic: { id: clinicId, category: "DENTAL", require2fa: false },
    ...extra,
  };
}

// ── Estado de cada prueba ──────────────────────────────────────────────
let filas: Fila[] = [];
let cookieClinica: string | null = null;
let rutaActual: string | null = "/api/dashboard/sidebar-counts";
let cookie2fa = false;
// Con qué (persona, clínica) se comprobó la cookie df_2fa: tiene que ser la sede ELEGIDA.
let pruebas2fa: Array<[string, string]> = [];
const consultas: Array<{ op: string; where: any; orderBy?: any }> = [];

beforeEach(() => {
  filas = [];
  cookieClinica = null;
  rutaActual = "/api/dashboard/sidebar-counts";
  cookie2fa = false;
  pruebas2fa = [];
  consultas.length = 0;
});

/** Prisma falso: evalúa el where como Prisma (supabaseId, isActive, clinicId, totpEnabled). */
function filtrar(where: any): Fila[] {
  return filas.filter((f) =>
    Object.entries(where ?? {}).every(([k, v]) => (f as any)[k] === v),
  );
}
const prismaFalso = {
  user: {
    findMany: async ({ where, orderBy }: any) => {
      consultas.push({ op: "user.findMany", where, orderBy });
      const r = filtrar(where);
      if (orderBy?.createdAt === "asc") r.sort((a, b) => +a.createdAt - +b.createdAt);
      return r;
    },
    findFirst: async ({ where, orderBy }: any) => {
      consultas.push({ op: "user.findFirst", where, orderBy });
      const r = filtrar(where);
      if (orderBy?.createdAt === "asc") r.sort((a, b) => +a.createdAt - +b.createdAt);
      return r[0] ?? null;
    },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/supabase/server", {
  namedExports: { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: SB } } }) } }) },
});
mock.module("@/lib/active-clinic", {
  namedExports: { readActiveClinicCookie: () => cookieClinica, logClinicFallback: () => {} },
});
mock.module("next/headers", {
  namedExports: { headers: () => ({ get: (k: string) => (k === "x-pathname" ? rutaActual : null) }) },
});
mock.module("@/lib/plan-status", {
  namedExports: { isPlanExpired: () => false, isApiPathBlockedForExpiredPlan: () => false },
});
mock.module("@/lib/auth/two-factor-cookie", {
  namedExports: {
    hasValidTwoFactorCookie: (supabaseId: string, clinicId: string) => {
      pruebas2fa.push([supabaseId, clinicId]);
      return cookie2fa;
    },
  },
});
// Si alguien vuelve a preguntar por las hermanas con otra consulta, que se note.
mock.module("@/lib/auth/two-factor-identity", {
  namedExports: {
    personaTieneDosFactores: async () => { consultas.push({ op: "personaTieneDosFactores", where: null }); return false; },
  },
});
// auth.ts: `cache` de React solo existe dentro de Next; `redirect` lanza como el real.
class Redireccion extends Error { constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); } }
mock.module("react", { namedExports: { cache: <T>(f: T) => f } });
mock.module("next/navigation", { namedExports: { redirect: (d: string) => { throw new Redireccion(d); } } });

// Import perezoso: los módulos reales se cargan DESPUÉS de los mock.module.
const getAuthContext = async () => (await import("@/lib/auth-context")).getAuthContext();
const getCurrentUser = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUser();

const soloUnaConsulta = () => {
  assert.deepEqual(consultas.map((c) => c.op), ["user.findMany"], "una sola lectura de users por petición");
  assert.deepEqual(consultas[0].where, { supabaseId: SB, isActive: true }, "el supabaseId sale de la sesión y exige isActive");
  assert.deepEqual(consultas[0].orderBy, { createdAt: "asc" });
};

// ══════════════════════════════════ getAuthContext ══════════════════════════════════

test("getAuthContext · cookie de una sede donde la persona está activa: esa sede, con UNA consulta", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01"), fila("u_b", "cli_b", "2026-01-01", { role: "DOCTOR" })];
  cookieClinica = "cli_b";
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_b");
  assert.equal(ctx?.userId, "u_b");
  assert.equal(ctx?.role, "DOCTOR", "el rol es el de ESA sede, no el de la primera");
  soloUnaConsulta();
});

test("getAuthContext · sin cookie: la primera sede por createdAt, como antes", async () => {
  filas = [fila("u_b", "cli_b", "2026-01-01"), fila("u_a", "cli_a", "2025-01-01")];
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_a");
  soloUnaConsulta();
});

test("getAuthContext · cookie de una clínica AJENA: nunca se entra en ella, cae a la primera propia", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01")];
  cookieClinica = "cli_ajena";
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_a");
  assert.notEqual(ctx?.clinicId, "cli_ajena");
  soloUnaConsulta();
});

test("getAuthContext · cookie de una sede donde la fila está DESACTIVADA: no se usa", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01"), fila("u_b", "cli_b", "2026-01-01", { isActive: false })];
  cookieClinica = "cli_b";
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_a");
});

test("getAuthContext · persona sin ninguna fila activa: null", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01", { isActive: false })];
  assert.equal(await getAuthContext(), null);
});

test("getAuthContext · EQ-02: el 2FA de una HERMANA corta la sede sin 2FA si falta la prueba", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01", { totpEnabled: true }), fila("u_b", "cli_b", "2026-01-01")];
  cookieClinica = "cli_b";
  assert.equal(await getAuthContext(), null, "fail-closed: sin df_2fa no hay contexto");
  soloUnaConsulta();
  assert.deepEqual(pruebas2fa, [[SB, "cli_b"]], "la prueba del segundo factor se pide para la sede ELEGIDA");

  consultas.length = 0;
  cookie2fa = true;
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_b", "con la prueba del segundo factor, entra");
  assert.equal(ctx?.user.totpEnabled, true, "totpEnabled sale corregido a nivel persona");
});

test("getAuthContext · nadie con 2FA ni clínica que lo exija: entra sin prueba", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01"), fila("u_b", "cli_b", "2026-01-01")];
  cookieClinica = "cli_b";
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_b");
  assert.equal(ctx?.user.totpEnabled, false);
});

// ══════════════════════════════════ getCurrentUser ══════════════════════════════════

test("getCurrentUser · cookie de una sede propia: esa sede, con UNA consulta", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01"), fila("u_b", "cli_b", "2026-01-01")];
  cookieClinica = "cli_b";
  const u = await getCurrentUser();
  assert.equal(u.clinicId, "cli_b");
  soloUnaConsulta();
});

test("getCurrentUser · cookie ajena: la primera propia, nunca la de la cookie", async () => {
  filas = [fila("u_b", "cli_b", "2026-01-01"), fila("u_a", "cli_a", "2025-01-01")];
  cookieClinica = "cli_ajena";
  const u = await getCurrentUser();
  assert.equal(u.clinicId, "cli_a");
  soloUnaConsulta();
});

test("getCurrentUser · EQ-02: el 2FA de una hermana manda al reto en /api (y no sirve el dato)", async () => {
  filas = [fila("u_a", "cli_a", "2025-01-01", { totpEnabled: true }), fila("u_b", "cli_b", "2026-01-01")];
  cookieClinica = "cli_b";
  await assert.rejects(() => getCurrentUser(), (e: unknown) => e instanceof Redireccion);
  soloUnaConsulta();

  consultas.length = 0;
  cookie2fa = true;
  const u = await getCurrentUser();
  assert.equal(u.clinicId, "cli_b");
  assert.equal(u.totpEnabled, true);
});

test("getCurrentUser · sin ninguna fila de clínica: sigue la cadena de siempre (aquí, onboarding)", async () => {
  // Proveedor, laboratorio, barbería e inmuebles: sus findFirst no existen en
  // este Prisma falso y los tres primeros lanzarían; el de barber/realty va
  // en try/catch. Lo que se fija es que sin filas NO se inventa una clínica.
  (prismaFalso as any).supplierUser = { findFirst: async () => null };
  (prismaFalso as any).dentalLabUser = { findFirst: async () => null };
  (prismaFalso as any).barberUser = { findFirst: async () => null };
  (prismaFalso as any).realtyUser = { findFirst: async () => null };
  filas = [];
  await assert.rejects(() => getCurrentUser(), (e: unknown) => e instanceof Redireccion && e.destino === "/onboarding");
});

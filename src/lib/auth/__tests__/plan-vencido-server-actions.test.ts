/**
 * ws1-t11 · lead 11 (auditoría run-2) — el gate de plan vencido también corta
 * las SERVER ACTIONS, no solo /api.
 *
 * Run: npm run test:plan-vencido-actions
 *
 * El hallazgo: getAuthContext / getCurrentUser decidían el corte por plan
 * vencido con el x-pathname y solo cortaban rutas /api. Una server action es
 * un POST a la URL de la página (/dashboard/...), así que una clínica vencida
 * seguía subiendo fotos clínicas, mandando recordatorios de ortodoncia, etc.
 * El redirect del layout a /dashboard/suspended es de RENDER: no impide que el
 * cuerpo de la action corra.
 *
 * Con getAuthContext / getCurrentUser REALES y la regla REAL de plan-status
 * (Prisma, Supabase, cookies y cabeceras de mentira). Lo que NO cambia:
 *   • pagar y pedir soporte (/dashboard/suspended, /dashboard/soporte y la
 *     allowlist de /api) siguen funcionando con el plan vencido;
 *   • la gracia de 24 h del cobro rechazado (past_due con periodo vivo) no es
 *     plan vencido;
 *   • las PÁGINAS siguen igual: las corta el layout, no getAuthContext.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const SB = "sb_persona";
const AYER = new Date(Date.now() - 86_400_000);
const EN_UNA_HORA = new Date(Date.now() + 3_600_000);

interface Fila {
  id: string;
  supabaseId: string;
  clinicId: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: Date;
  permissionsOverride: string[];
  clinic: { id: string; category: string; require2fa: boolean; trialEndsAt: Date | null; subscriptionStatus: string | null };
}

function fila(clinic: Partial<Fila["clinic"]> = {}): Fila {
  return {
    id: "u_a",
    supabaseId: SB,
    clinicId: "cli_a",
    role: "ADMIN",
    isActive: true,
    totpEnabled: false,
    createdAt: new Date("2025-01-01"),
    permissionsOverride: [],
    clinic: { id: "cli_a", category: "DENTAL", require2fa: false, trialEndsAt: AYER, subscriptionStatus: "canceled", ...clinic },
  };
}

let filas: Fila[] = [];
let cab: Record<string, string | null> = {};

beforeEach(() => {
  filas = [];
  cab = {};
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
  namedExports: { headers: () => ({ get: (k: string) => cab[k.toLowerCase()] ?? null }) },
});
mock.module("@/lib/auth/two-factor-cookie", {
  namedExports: { hasValidTwoFactorCookie: () => false, hasValidVerComoCookie: () => false },
});
mock.module("@/lib/auth/two-factor-identity", {
  namedExports: { personaTieneDosFactores: async () => false },
});
mock.module("@/lib/sede-clave/gate.server", { namedExports: { sedeCerradaPara: async () => false } });
class Redireccion extends Error { constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); } }
mock.module("react", { namedExports: { cache: <T>(f: T) => f } });
mock.module("next/navigation", { namedExports: { redirect: (d: string) => { throw new Redireccion(d); } } });

const getAuthContext = async () => (await import("@/lib/auth-context")).getAuthContext();
const getCurrentUser = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUser();
const alPago = (e: unknown) => e instanceof Redireccion && e.destino === "/dashboard/suspended";

function serverAction(ruta: string | null) {
  cab = { "x-pathname": ruta, "next-action": "7f3a0c", "content-type": "text/plain;charset=UTF-8" };
}

// ══════════════════ el hueco ══════════════════

test("server action de una clínica VENCIDA desde /dashboard/patients/p1: getAuthContext no da contexto", async () => {
  filas = [fila()];
  serverAction("/dashboard/patients/p1");
  assert.equal(await getAuthContext(), null, "antes del arreglo devolvía el contexto con isPlanExpired: true");
});

test("server action de una clínica VENCIDA: getCurrentUser manda a la pantalla de pago", async () => {
  filas = [fila()];
  serverAction("/dashboard/specialties/orthodontics");
  await assert.rejects(() => getCurrentUser(), alPago);
});

test("la action por formulario (multipart, sin cabecera next-action) también se corta", async () => {
  filas = [fila()];
  cab = { "x-pathname": "/dashboard/patients/p1", "content-type": "multipart/form-data; boundary=x" };
  assert.equal(await getAuthContext(), null);
  await assert.rejects(() => getCurrentUser(), alPago);
});

test("server action sin x-pathname (POST a una página fuera del middleware): falla cerrado", async () => {
  filas = [fila()];
  serverAction(null);
  assert.equal(await getAuthContext(), null);
});

test("una subida multipart a una ruta /api NO exenta sigue cortada como siempre", async () => {
  filas = [fila()];
  cab = { "x-pathname": "/api/xrays", "content-type": "multipart/form-data; boundary=x" };
  assert.equal(await getAuthContext(), null);
});

// ══════════════════ lo que NO cambia ══════════════════

test("una x-pathname inventada no abre nada: la action con cabecera se corta sin mirar la ruta", async () => {
  // Fuera del matcher del middleware (p. ej. /share/p/[token], que trae las
  // actions de share-links) x-pathname la pone el cliente.
  filas = [fila()];
  for (const ruta of ["/dashboard/suspended", "/dashboard/soporte/t1", "/api/billing/checkout", "/api/auth/logout"]) {
    serverAction(ruta);
    assert.equal(await getAuthContext(), null, ruta);
    await assert.rejects(() => getCurrentUser(), alPago, ruta);
  }
});

test("vencida: la pantalla de pago y la de soporte se siguen PINTANDO (GET, sin action)", async () => {
  filas = [fila()];
  for (const ruta of ["/dashboard/suspended", "/dashboard/suspended/success", "/dashboard/soporte", "/dashboard/soporte/t1"]) {
    cab = { "x-pathname": ruta };
    assert.equal((await getAuthContext())?.clinicId, "cli_a", ruta);
    assert.equal((await getCurrentUser()).clinicId, "cli_a", ruta);
  }
});

test("vencida: /api de pago, auth y soporte siguen abiertas (también con multipart)", async () => {
  filas = [fila()];
  for (const ruta of ["/api/billing/checkout", "/api/auth/logout", "/api/support/tickets", "/api/switch-clinic"]) {
    cab = { "x-pathname": ruta, "content-type": "multipart/form-data; boundary=x" };
    assert.equal((await getAuthContext())?.clinicId, "cli_a", ruta);
  }
});

test("vencida: una PÁGINA (GET, sin action) sigue igual — la corta el layout, no getAuthContext", async () => {
  filas = [fila()];
  cab = { "x-pathname": "/dashboard/patients/p1" };
  const ctx = await getAuthContext();
  assert.equal(ctx?.clinicId, "cli_a");
  assert.equal(ctx?.isPlanExpired, true);
});

test("cobro rechazado con la gracia de 24 h viva (past_due, periodo por delante): las actions pasan", async () => {
  filas = [fila({ trialEndsAt: EN_UNA_HORA, subscriptionStatus: "past_due" })];
  serverAction("/dashboard/patients/p1");
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
  assert.equal((await getCurrentUser()).clinicId, "cli_a");
});

test("pasada la gracia (past_due con el periodo terminado): se corta", async () => {
  filas = [fila({ trialEndsAt: AYER, subscriptionStatus: "past_due" })];
  serverAction("/dashboard/patients/p1");
  assert.equal(await getAuthContext(), null);
});

test("clínica al corriente: las actions pasan aunque trialEndsAt esté en el pasado", async () => {
  filas = [fila({ trialEndsAt: AYER, subscriptionStatus: "active" })];
  serverAction("/dashboard/patients/p1");
  assert.equal((await getAuthContext())?.clinicId, "cli_a");
  assert.equal((await getCurrentUser()).clinicId, "cli_a");
});

// ══════════════════ la regla, sin dobles ══════════════════

test("isApiPathBlockedForExpiredPlan: cabecera siempre; /api por su allowlist; formulario fuera de /api; GET de página no", async () => {
  const { isApiPathBlockedForExpiredPlan: b } = await import("@/lib/plan-status");
  assert.equal(b("/dashboard/suspended", "cabecera"), true);
  assert.equal(b("/api/billing/checkout", "cabecera"), true);
  assert.equal(b(null, "cabecera"), true);
  assert.equal(b("/api/billing/checkout", "formulario"), false, "subir a una ruta exenta sigue abierto");
  assert.equal(b("/api/support/tickets", "formulario"), false);
  assert.equal(b("/api/xrays", "formulario"), true);
  assert.equal(b("/dashboard/patients/p1", "formulario"), true);
  assert.equal(b(null, "formulario"), true);
  assert.equal(b("/dashboard/patients/p1"), false, "las páginas las corta el layout");
  assert.equal(b("/api/xrays"), true);
  assert.equal(b("/api/billing/portal"), false);
});

test("esPeticionDeServerAction: cabecera, formulario o nada", async () => {
  const { esPeticionDeServerAction: e } = await import("@/lib/auth/peticion-server-action");
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(e(h({ "next-action": "abc" })), "cabecera");
  assert.equal(e(h({ "next-action": "abc", "content-type": "multipart/form-data; boundary=x" })), "cabecera");
  assert.equal(e(h({ "content-type": "multipart/form-data; boundary=x" })), "formulario");
  assert.equal(e(h({ "content-type": "application/x-www-form-urlencoded" })), "formulario");
  assert.equal(e(h({ "content-type": "application/json" })), false);
  assert.equal(e(h({})), false);
});

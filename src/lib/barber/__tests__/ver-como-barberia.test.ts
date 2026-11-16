/**
 * «Ver como barbería» (ws6-t1, 16-nov-2026) — el «Ver como clínica» del dental
 * para /admin/barberias.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/barber/__tests__/ver-como-barberia.test.ts
 *
 * Fija:
 *   · sin sesión de admin de plataforma → 403 y no se genera ningún acceso;
 *   · sin la tabla (SQL sin pegar) → 503 y no se abre nada;
 *   · entrar: registra la sesión por su session_id (2 h, la misma vida que el
 *     dental) en barber_admin_impersonation_sessions, abre la sede pedida,
 *     guarda la sesión previa del admin y nunca hace un signOut global;
 *   · barbería suspendida o pendiente de pago: SÍ se entra (lo que ve el dueño);
 *     sin dueño → 404; dueño que también es de una clínica dental → 409;
 *     con un «Ver como clínica» abierto → 409 sin tocar nada del dental;
 *   · caducidad: vencida o cerrada, getBarberContext = sin sesión;
 *   · activa: ctx.verComo, sin «último acceso» del dueño y sin forzar el cambio
 *     de su contraseña temporal;
 *   · salir («Salir y volver a /admin» y «Cerrar sesión»): solo local, vuelve a
 *     la sesión de antes y a la ficha de la barbería;
 *   · lo bloqueado responde 403 VER_COMO_BLOQUEADO (y cada ruta de la lista lo llama).
 *
 * Base y Supabase simulados (mock.module), sin .env.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function jwt(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(claims)}.firma`;
}

// ── estado de los dobles ──
let hayAdmin = true;
let tablaBarber = true;
let tablasDental = true;
/** Filas de barber_admin_impersonation_sessions por supabaseSessionId. */
const filasBarber = new Map<string, Record<string, unknown>>();
/** Fila de admin_impersonation_sessions (dental) de la sesión actual, si la hay. */
let filaDental: Record<string, unknown> | null = null;
let sesion: { access_token: string; refresh_token?: string } | null = null;
let usuario: { id: string; last_sign_in_at?: string; app_metadata?: Record<string, unknown>; email?: string } | null = null;
let tienda: Record<string, unknown> | null = null;
let raiz: Record<string, unknown> | null = null;
let dueno: Record<string, unknown> | null = null;
let duenoEsDental = false;
let usuarioDelCanje: string | null = "sb-rafael";
let generateLinkLlamadas = 0;
const sqlEjecutado: { sql: string; valores: unknown[] }[] = [];
const signOuts: unknown[] = [];
const canjes: string[] = [];
const updateManyLlamadas: unknown[] = [];

const prismaFalso = {
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("to_regclass('public.barber_admin_impersonation_sessions')")) return [{ ok: tablaBarber }];
    if (sql.includes("to_regclass")) return [{ ok: tablasDental }];
    if (/FROM "barber_admin_impersonation_sessions"/.test(sql)) {
      const f = filasBarber.get(String(valores[0]));
      return f ? [f] : [];
    }
    if (/FROM "admin_impersonation_sessions"/.test(sql)) return filaDental ? [filaDental] : [];
    return [];
  },
  $executeRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    sqlEjecutado.push({ sql, valores });
    if (sql.includes('INSERT INTO "barber_admin_impersonation_sessions"')) {
      const [id, adminUserId, adminEmail, barbershopId, targetBarberUserId, , supabaseSessionId, , , , expiresAt] = valores;
      filasBarber.set(String(supabaseSessionId), { id, adminUserId, adminEmail, barbershopId, targetBarberUserId, expiresAt, endedAt: null });
    }
    if (sql.includes('UPDATE "barber_admin_impersonation_sessions"')) {
      for (const f of filasBarber.values()) {
        if (f.id === valores[valores.length - 1] && !f.endedAt) f.endedAt = new Date();
      }
    }
    return 1;
  },
  barbershop: {
    findUnique: async (a: { where: { id: string } }) => {
      if (tienda && a.where.id === tienda.id) return tienda;
      if (raiz && a.where.id === raiz.id) return raiz;
      return null;
    },
  },
  barberUser: {
    findFirst: async (a: { select?: Record<string, unknown>; include?: unknown }) => {
      if (a.select) return dueno; // el dueño con el que se entra
      if (!usuario) return null;
      return {
        id: "bu-dueno", barbershopId: "shop-1", supabaseId: usuario.id, email: "dueno@example.com",
        firstName: "D", lastName: "Ueño", role: "OWNER", permissionsOverride: [], isActive: true, lastLogin: null,
        barberId: null, barber: null,
        barbershop: { id: "shop-1", name: "Barba Negra", parentId: null, isActive: true, plan: "PRO", subscriptionStatus: "active", locale: "es" },
      };
    },
    updateMany: async (a: unknown) => { updateManyLlamadas.push(a); return { count: 1 }; },
  },
  user: { findFirst: async () => (duenoEsDental ? { id: "u-dental" } : null) },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: sesion } }),
        getUser: async () => ({ data: { user: usuario } }),
        signOut: async (o?: unknown) => { signOuts.push(o ?? "global"); sesion = null; return { error: null }; },
        refreshSession: async (s: { refresh_token: string }) => {
          canjes.push(s.refresh_token);
          return usuarioDelCanje
            ? { data: { user: { id: usuarioDelCanje }, session: {} }, error: null }
            : { data: { user: null, session: null }, error: new Error("refresh token revocado") };
        },
        verifyOtp: async () => {
          sesion = { access_token: jwt({ session_id: "ses-nueva", sub: "sb-dueno" }), refresh_token: "rt-dueno" };
          return { data: { session: sesion }, error: null };
        },
      },
    }),
  },
});
mock.module("@/lib/admin/supabase-admin", {
  namedExports: {
    clienteAdminSupabase: () => ({
      auth: { admin: {
        generateLink: async () => { generateLinkLlamadas++; return { data: { properties: { hashed_token: "h" } }, error: null }; },
        signOut: async () => ({ error: null }),
      } },
    }),
  },
});
mock.module("@/lib/admin-auth", {
  namedExports: {
    getAdminSession: async () => (hayAdmin ? { user: { id: "adm-1", email: "admin@dalecontrol.com", role: "ADMIN" } } : null),
  },
});

const core = () => import("../ver-como-core");
const lib = () => import("../ver-como");
const libDental = () => import("../../admin/suplantacion");
const entrar = () => import("../../../app/api/admin/barberias/[id]/ver-como/route");
const salir = () => import("../../../app/api/admin/barberias/ver-como/salir/route");
const logout = () => import("../../../app/api/barber/auth/logout/route");
const auth = () => import("../../barber-auth");

beforeEach(async () => {
  hayAdmin = true; tablaBarber = true; tablasDental = true; filasBarber.clear(); filaDental = null;
  sesion = { access_token: jwt({ session_id: "ses-admin", sub: "sb-rafael" }), refresh_token: "rt-rafael" };
  usuario = { id: "sb-rafael" };
  tienda = { id: "shop-1", name: "Barba Negra", parentId: null, isActive: true, subscriptionStatus: "active" };
  raiz = null;
  dueno = { id: "bu-dueno", supabaseId: "sb-dueno", email: "dueno@example.com" };
  duenoEsDental = false; usuarioDelCanje = "sb-rafael"; generateLinkLlamadas = 0;
  sqlEjecutado.length = 0; signOuts.length = 0; canjes.length = 0; updateManyLlamadas.length = 0;
  (await lib())._reiniciarCacheVerComo();
  (await libDental())._reiniciarCacheSuplantacion();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srk";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
});

function post(ruta: string, cookie?: string) {
  return new NextRequest(`http://dev.local${ruta}`, {
    method: "POST",
    body: "",
    headers: {
      "content-type": "application/x-www-form-urlencoded", host: "dev.local", origin: "http://dev.local",
      ...(cookie ? { cookie } : {}),
    },
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const insertos = () => sqlEjecutado.filter((s) => s.sql.includes('INSERT INTO "barber_admin_impersonation_sessions"'));

// ── entrar ──

test("rol no admin (sin sesión de admin de plataforma) → 403 y no se genera ningún acceso", async () => {
  hayAdmin = false;
  const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 403);
  assert.equal(generateLinkLlamadas, 0);
  assert.equal(insertos().length, 0);
});

test("sin la tabla (SQL sin pegar) → 503 con el nombre del SQL y no se abre nada", async () => {
  tablaBarber = false;
  const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /barber_admin_ver_como\.sql/);
  assert.equal(generateLinkLlamadas, 0);
});

test("GET no abre nada (405): se entra solo con el botón (POST)", async () => {
  const res = await (await entrar()).GET(new NextRequest("http://dev.local/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 405);
  assert.equal(generateLinkLlamadas, 0);
});

test("entrar: bitácora con el admin, la barbería, el dueño y 2 h; abre /barber en esa sede; guarda la sesión previa", async () => {
  const antes = Date.now();
  const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como", "dcb_branch=sede-vieja"), params("shop-1"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "http://dev.local/barber");
  const [ins] = insertos();
  assert.ok(ins, "se registró la sesión");
  const [, adminUserId, adminEmail, barbershopId, targetBarberUserId, targetSupabaseId, sessionId, nota, , , expiresAt] = ins.valores;
  assert.equal(adminUserId, "adm-1");
  assert.equal(adminEmail, "admin@dalecontrol.com");
  assert.equal(barbershopId, "shop-1");
  assert.equal(targetBarberUserId, "bu-dueno");
  assert.equal(targetSupabaseId, "sb-dueno");
  assert.equal(sessionId, "ses-nueva");
  assert.equal(nota, "Entrada de soporte");
  const vida = (expiresAt as Date).getTime() - antes;
  const { DURACION_SUPLANTACION_MS } = await import("../../admin/suplantacion-core");
  assert.ok(vida >= DURACION_SUPLANTACION_MS - 2000 && vida <= DURACION_SUPLANTACION_MS + 2000, "misma vida que «Ver como clínica»");
  assert.equal(res.cookies.get("dcb_branch")?.value, "shop-1", "abre la sede pedida");
  const previa = (await core()).desempacarPreviaBarber(res.cookies.get("dcb_ver_como_previa")?.value);
  assert.deepEqual(previa, { rt: "rt-rafael", sub: "sb-rafael", sede: "sede-vieja" });
  assert.equal(res.cookies.get("dcb_ver_como_previa")?.path, "/api");
  assert.ok(!signOuts.includes("global"), "nunca un signOut global");
  // No toca nada del dental: ni su cookie de sesión previa ni la de la pestaña ni su 2FA.
  for (const c of ["df_sesion_previa", "df_ver_como", "df_2fa_admin", "activeClinicId"]) {
    assert.equal(res.cookies.get(c), undefined, `no escribe ${c}`);
  }
});

test("barbería suspendida o pendiente de pago: se entra igual (ve lo que vería el dueño)", async () => {
  for (const st of ["suspended", "pending_payment", "past_due", "canceled"]) {
    filasBarber.clear(); sqlEjecutado.length = 0;
    sesion = { access_token: jwt({ session_id: "ses-admin", sub: "sb-rafael" }), refresh_token: "rt-rafael" };
    tienda = { ...tienda!, subscriptionStatus: st };
    const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
    assert.equal(res.status, 303, st);
    assert.equal(insertos().length, 1, st);
  }
  const { decidirEntrada } = await core();
  const base = { owner: { id: "b", supabaseId: "s", email: "e" }, ownerEsTambienDental: false };
  assert.deepEqual(decidirEntrada({ ...base, shop: { id: "x", name: "x", parentId: null, isActive: true, subscriptionStatus: "pending_payment" } }), { ok: true, aviso: "pendiente" });
  assert.deepEqual(decidirEntrada({ ...base, shop: { id: "x", name: "x", parentId: null, isActive: true, subscriptionStatus: "suspended" } }), { ok: true, aviso: "suspendida" });
  assert.deepEqual(decidirEntrada({ ...base, shop: { id: "x", name: "x", parentId: null, isActive: true, subscriptionStatus: "active" } }), { ok: true, aviso: null });
});

test("sucursal: entra con el dueño de la matriz a ESA sede; su suscripción es la de la matriz", async () => {
  tienda = { id: "suc-1", name: "Barba Negra Norte", parentId: "shop-1", isActive: true, subscriptionStatus: "pending_payment" };
  raiz = { id: "shop-1", subscriptionStatus: "active" };
  const res = await (await entrar()).POST(post("/api/admin/barberias/suc-1/ver-como"), params("suc-1"));
  assert.equal(res.status, 303);
  assert.equal(res.cookies.get("dcb_branch")?.value, "suc-1");
  assert.equal(insertos()[0].valores[3], "suc-1");
});

test("sin dueño activo → 404; barbería inexistente → 404; nada se abre", async () => {
  dueno = null;
  let res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 404);
  assert.match(await res.text(), /sin dueño/);
  tienda = null;
  res = await (await entrar()).POST(post("/api/admin/barberias/nada/ver-como"), params("nada"));
  assert.equal(res.status, 404);
  assert.equal(generateLinkLlamadas, 0);
});

test("dueño que también entra a una clínica dental → 409 (la sesión valdría en /dashboard sin las 2 h)", async () => {
  duenoEsDental = true;
  const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 409);
  assert.equal(generateLinkLlamadas, 0);
});

test("con un «Ver como clínica» abierto en el navegador → 409 y no toca nada del dental", async () => {
  filaDental = { id: "dent-1", adminUserId: "adm-1", adminEmail: "a", clinicId: "c1", targetUserId: "u", expiresAt: new Date(Date.now() + 3600_000), endedAt: null };
  const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 409);
  assert.equal(generateLinkLlamadas, 0);
  assert.equal(signOuts.length, 0);
  assert.ok(!sqlEjecutado.some((s) => s.sql.includes('"admin_impersonation_sessions"')), "la tabla del dental no se escribe");
});

test("entrar desde otro «Ver como barbería»: cierra el anterior (reemplazada) y conserva la copia de antes", async () => {
  sesion = { access_token: jwt({ session_id: "ses-vieja", sub: "sb-otro" }), refresh_token: "rt-otro" };
  filasBarber.set("ses-vieja", { id: "vc-viejo", adminUserId: "adm-1", adminEmail: "a", barbershopId: "shop-9", targetBarberUserId: "b", expiresAt: new Date(Date.now() + 3600_000), endedAt: null });
  const res = await (await entrar()).POST(post("/api/admin/barberias/shop-1/ver-como"), params("shop-1"));
  assert.equal(res.status, 303);
  assert.ok(sqlEjecutado.some((s) => s.sql.includes('"endedReason" = ') && s.valores.includes("reemplazada")));
  assert.deepEqual(signOuts, [{ scope: "local" }]);
  assert.equal(res.cookies.get("dcb_ver_como_previa"), undefined, "no guarda la sesión de soporte como «la de antes»");
});

// ── caducidad y contexto ──

test("caducidad: vencida o cerrada vale como «terminada»; activa dentro de las 2 h", async () => {
  const { estadoVerComo, VER_COMO_DURACION_MS } = await core();
  const ahora = Date.now();
  const fila = { id: "f", adminUserId: "a", adminEmail: "a", barbershopId: "s", targetBarberUserId: "b", endedAt: null as Date | null };
  assert.equal(estadoVerComo(null).tipo, "normal");
  assert.equal(estadoVerComo({ ...fila, expiresAt: new Date(ahora + VER_COMO_DURACION_MS) }, ahora).tipo, "activa");
  assert.equal(estadoVerComo({ ...fila, expiresAt: new Date(ahora - 1) }, ahora).tipo, "terminada");
  assert.equal(estadoVerComo({ ...fila, expiresAt: new Date(ahora + 1000), endedAt: new Date(ahora) }, ahora).tipo, "terminada");
});

test("getBarberContext: con la sesión vencida = sin sesión (aunque el navegador guarde las cookies)", async () => {
  usuario = { id: "sb-dueno" };
  sesion = { access_token: jwt({ session_id: "ses-x", sub: "sb-dueno" }) };
  filasBarber.set("ses-x", { id: "vc-1", adminUserId: "adm-1", adminEmail: "admin@dalecontrol.com", barbershopId: "shop-1", targetBarberUserId: "bu-dueno", expiresAt: new Date(Date.now() - 1000), endedAt: null });
  assert.equal(await (await auth()).getBarberContext(), null);
  // y se marca cerrada por vencida
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(sqlEjecutado.some((s) => s.sql.includes("'vencida'")));
});

test("getBarberContext activo: ctx.verComo, sin «último acceso» del dueño y sin forzar su contraseña temporal", async () => {
  const { BARBER_MUST_CHANGE_KEY } = await import("../contrasena");
  usuario = { id: "sb-dueno", last_sign_in_at: new Date().toISOString(), app_metadata: { [BARBER_MUST_CHANGE_KEY]: true } };
  sesion = { access_token: jwt({ session_id: "ses-x", sub: "sb-dueno" }) };
  const vence = new Date(Date.now() + 3600_000);
  filasBarber.set("ses-x", { id: "vc-1", adminUserId: "adm-1", adminEmail: "admin@dalecontrol.com", barbershopId: "shop-1", targetBarberUserId: "bu-dueno", expiresAt: vence, endedAt: null });
  const ctx = await (await auth()).getBarberContext();
  assert.ok(ctx);
  assert.deepEqual(ctx!.verComo, { id: "vc-1", adminEmail: "admin@dalecontrol.com", expiresAt: vence.toISOString() });
  assert.equal(ctx!.mustChangePassword, false);
  assert.equal(updateManyLlamadas.length, 0, "el «último acceso» del dueño no se mueve");
});

test("getBarberContext normal: igual que antes (último acceso y contraseña temporal)", async () => {
  const { BARBER_MUST_CHANGE_KEY } = await import("../contrasena");
  usuario = { id: "sb-dueno", last_sign_in_at: new Date().toISOString(), app_metadata: { [BARBER_MUST_CHANGE_KEY]: true } };
  sesion = { access_token: jwt({ session_id: "ses-propia", sub: "sb-dueno" }) };
  const ctx = await (await auth()).getBarberContext();
  assert.ok(ctx);
  assert.equal(ctx!.verComo, null);
  assert.equal(ctx!.mustChangePassword, true);
  assert.equal(updateManyLlamadas.length, 1);
});

// ── salir ──

test("«Salir y volver a /admin»: cierra (local), vuelve a la sesión de antes y a la ficha; restaura la sede", async () => {
  sesion = { access_token: jwt({ session_id: "ses-x", sub: "sb-dueno" }) };
  filasBarber.set("ses-x", { id: "vc-1", adminUserId: "adm-1", adminEmail: "a", barbershopId: "shop-1", targetBarberUserId: "bu-dueno", expiresAt: new Date(Date.now() + 3600_000), endedAt: null });
  const { empacarPreviaBarber } = await core();
  const previa = empacarPreviaBarber({ rt: "rt-rafael", sub: "sb-rafael", sede: "sede-vieja" });
  const res = await (await salir()).POST(post("/api/admin/barberias/ver-como/salir", `dcb_ver_como_previa=${previa}`));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "http://dev.local/admin/barberias/shop-1");
  assert.ok(sqlEjecutado.some((s) => s.valores.includes("salida")), "bitácora: cerrada por salida");
  assert.deepEqual(canjes, ["rt-rafael"]);
  assert.ok(!signOuts.includes("global"));
  assert.equal(res.cookies.get("dcb_branch")?.value, "sede-vieja");
  assert.equal(res.cookies.get("dcb_ver_como_previa")?.value, "");
});

test("«Salir» con una sesión normal no cierra nada", async () => {
  const res = await (await salir()).POST(post("/api/admin/barberias/ver-como/salir"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "http://dev.local/admin/barberias");
  assert.equal(signOuts.length, 0);
  assert.equal(sqlEjecutado.length, 0);
});

test("«Cerrar sesión» del panel en «Ver como barbería»: solo local y a la ficha; fuera de ella, como siempre", async () => {
  sesion = { access_token: jwt({ session_id: "ses-x", sub: "sb-dueno" }) };
  filasBarber.set("ses-x", { id: "vc-1", adminUserId: "adm-1", adminEmail: "a", barbershopId: "shop-1", targetBarberUserId: "bu-dueno", expiresAt: new Date(Date.now() + 3600_000), endedAt: null });
  let res = await (await logout()).POST(new Request("http://dev.local/api/barber/auth/logout", { method: "POST" }));
  assert.deepEqual(await res.json(), { ok: true, redirect: "/admin/barberias/shop-1" });
  assert.deepEqual(signOuts, [{ scope: "local" }], "nunca global: echaría al dueño de todos sus dispositivos");
  signOuts.length = 0;
  sesion = { access_token: jwt({ session_id: "ses-propia", sub: "sb-dueno" }) };
  res = await (await logout()).POST(new Request("http://dev.local/api/barber/auth/logout", { method: "POST" }));
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(signOuts, ["global"], "el dueño de verdad cierra como siempre");
});

// ── bloqueos ──

test("lo bloqueado responde 403 VER_COMO_BLOQUEADO (es/en); una sesión normal pasa", async () => {
  const { respuestaSiVerComo } = await lib();
  assert.equal(respuestaSiVerComo({ verComo: null }), null);
  assert.equal(respuestaSiVerComo(null), null);
  const r = respuestaSiVerComo({ verComo: { id: "vc-1" }, barbershop: { locale: "en" } })!;
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.code, "VER_COMO_BLOQUEADO");
  assert.match(body.error, /viewing as this barbershop/);
  const es = await respuestaSiVerComo({ verComo: { id: "vc-1" }, barbershop: { locale: "es" } })!.json();
  assert.match(es.error, /Ver como barbería/);
});

test("cada ruta de BLOQUEOS_VER_COMO corta con respuestaSiVerComo (o ctx.verComo) en cada método", async () => {
  const { BLOQUEOS_VER_COMO } = await core();
  assert.ok(BLOQUEOS_VER_COMO.length >= 9);
  for (const b of BLOQUEOS_VER_COMO) {
    const src = readFileSync(join(RAIZ, b.ruta), "utf8");
    for (const m of b.metodos) {
      const i = src.indexOf(`export async function ${m}(`);
      assert.ok(i >= 0, `${b.ruta} exporta ${m}`);
      const resto = src.slice(i + 10);
      const fin = resto.search(/\nexport async function /);
      const cuerpo = fin >= 0 ? resto.slice(0, fin) : resto;
      assert.ok(/respuestaSiVerComo\(|ctx\.verComo/.test(cuerpo), `${b.ruta} ${m} no bloquea «Ver como barbería»`);
    }
  }
});

test("de verdad: cambiar la contraseña del dueño en «Ver como barbería» → 403 y no se toca la cuenta", async () => {
  usuario = { id: "sb-dueno", email: "dueno@example.com" };
  sesion = { access_token: jwt({ session_id: "ses-x", sub: "sb-dueno" }) };
  filasBarber.set("ses-x", { id: "vc-1", adminUserId: "adm-1", adminEmail: "a", barbershopId: "shop-1", targetBarberUserId: "bu-dueno", expiresAt: new Date(Date.now() + 3600_000), endedAt: null });
  const ruta = await import("../../../app/api/barber/auth/contrasena/route");
  const res = await ruta.POST(new NextRequest("http://dev.local/api/barber/auth/contrasena", {
    method: "POST", body: JSON.stringify({ password: "Nueva-Clave-2026!", confirmacion: "Nueva-Clave-2026!", currentPassword: "x" }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "VER_COMO_BLOQUEADO");
});

test("el panel pinta la barra y el admin tiene el botón en la ficha y en la lista (cableado)", () => {
  const layout = readFileSync(join(RAIZ, "src/app/barber/(panel)/layout.tsx"), "utf8");
  assert.match(layout, /ctx\.verComo && \(\s*<VerComoBarra/);
  const barra = readFileSync(join(RAIZ, "src/components/barber/ver-como-barra.tsx"), "utf8");
  assert.match(barra, /action="\/api\/admin\/barberias\/ver-como\/salir"/);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(barra), "la barra usa tokens, no hex");
  for (const f of ["src/app/admin/barberias/[id]/barbershop-detail-client.tsx", "src/app/admin/barberias/barberias-client.tsx"]) {
    assert.match(readFileSync(join(RAIZ, f), "utf8"), /<BotonVerComoBarberia barbershopId=\{(shop|row)\.id\}/, f);
  }
  for (const l of ["es", "en"]) {
    const d = JSON.parse(readFileSync(join(RAIZ, `src/i18n/dictionaries/barber/shell.${l}.json`), "utf8"));
    assert.deepEqual(Object.keys(d.verComo).sort(), ["before", "exit", "middle", "until"], l);
  }
});

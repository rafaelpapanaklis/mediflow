/**
 * ws1-t12 · /api/track con la base en apuros (incidente del 1-oct-2026).
 *
 * Run: npm run test:conexiones-base
 *
 *   · un robot conocido sale ANTES de leer el cuerpo: ni base ni Supabase;
 *   · tras un fallo de CONEXIÓN (EMAXCONN, P2024…) la instancia deja de ir a
 *     la base un minuto: el siguiente POST no la toca (sin reintentos);
 *   · un fallo de datos no pausa nada;
 *   · la respuesta no espera a una base colgada más de ~2 s.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const llamadas: string[] = [];
let suplantacionConsultada = 0;
let fallo: Error | null = null;
let colgada = false;

const prismaAdminFalso = new Proxy({}, {
  get: (_t, modelo: string) => new Proxy({}, {
    get: (_u, metodo: string) => async () => {
      llamadas.push(`${modelo}.${metodo}`);
      if (colgada) await new Promise(() => {});
      if (fallo) throw fallo;
      return metodo === "findUnique" ? null : { count: 0 };
    },
  }),
});

mock.module("@/lib/prisma-admin", { namedExports: { prismaAdmin: prismaAdminFalso } });
mock.module("@/lib/admin/suplantacion", {
  namedExports: { suplantacionDeEstaPeticion: async () => { suplantacionConsultada++; return null; } },
});
mock.module("@/lib/analytics/identity", {
  namedExports: { resolveIdentity: async () => ({ identityType: "anonymous", clinicId: null }) },
});
mock.module("@/lib/analytics/geo", { namedExports: { resolveGeo: async () => ({}) } });

const ruta = () => import("../route");
const pausa = () => import("@/lib/analytics/pausa-por-fallo");

const NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

function pedir(ua = NAVEGADOR) {
  const body = { sid: "s_123456789012", vid: "v_123456789012", events: [{ type: "pageview", path: "/blog/agenda-dental" }] };
  return new NextRequest("http://dev.local/api/track", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { host: "dev.local", origin: "http://dev.local", "user-agent": ua },
  });
}

beforeEach(async () => {
  llamadas.length = 0;
  suplantacionConsultada = 0;
  fallo = null;
  colgada = false;
  (await pausa())._reiniciarPausa();
});

test("testigo: una persona sí llega a la base", async () => {
  const r = await (await ruta()).POST(pedir());
  assert.equal(r.status, 204);
  assert.ok(llamadas.length > 0);
});

test("robots conocidos: 204 sin tocar la base, ni Supabase, ni leer el cuerpo", async () => {
  const { POST } = await ruta();
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "python-requests/2.31",
  ]) {
    const req = pedir(ua);
    const r = await POST(req);
    assert.equal(r.status, 204);
    assert.equal(req.bodyUsed, false, `no lee el cuerpo: ${ua}`);
  }
  assert.deepEqual(llamadas, []);
  assert.equal(suplantacionConsultada, 0);
});

test("pooler lleno (EMAXCONN): la instancia deja de ir a la base; el siguiente POST no la toca", async () => {
  const { POST } = await ruta();
  fallo = new Error("FATAL: (EMAXCONN) max client connections reached, limit: 200");
  assert.equal((await POST(pedir())).status, 204);
  assert.equal(llamadas.length, 1, "un solo intento, sin reintentos");
  llamadas.length = 0;
  fallo = null;
  assert.equal((await POST(pedir())).status, 204);
  assert.deepEqual(llamadas, [], "en pausa: ni se intenta");
});

test("P2024 (sin conexión libre en el pool) también pausa; un error de datos NO", async () => {
  const { esFalloDeConexion, pausarSiFalloDeConexion, analiticaEnPausa } = await pausa();
  assert.equal(esFalloDeConexion(Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" })), true);
  assert.equal(esFalloDeConexion({ name: "PrismaClientInitializationError", message: "x" }), true);
  assert.equal(esFalloDeConexion(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })), false);
  assert.equal(esFalloDeConexion(null), false);
  assert.equal(pausarSiFalloDeConexion(Object.assign(new Error("dato"), { code: "P2000" }), 1000), false);
  assert.equal(analiticaEnPausa(1001), false);
  assert.equal(pausarSiFalloDeConexion(Object.assign(new Error("x"), { code: "P2024" }), 1000), true);
  assert.equal(analiticaEnPausa(1001), true);
  assert.equal(analiticaEnPausa(1000 + 60_000), false, "a los 60 s vuelve a intentarlo");
});

test("error de datos en la ingesta: no pausa (la siguiente visita sí va a la base)", async () => {
  const { POST } = await ruta();
  fallo = Object.assign(new Error("Invalid value"), { code: "P2009" });
  await POST(pedir());
  llamadas.length = 0;
  fallo = null;
  await POST(pedir());
  assert.ok(llamadas.length > 0);
});

test("base colgada: la respuesta sale en ~2 s, no espera a la base", async () => {
  const { POST } = await ruta();
  colgada = true;
  const t0 = Date.now();
  const r = await POST(pedir());
  const ms = Date.now() - t0;
  assert.equal(r.status, 204);
  assert.ok(ms >= 1_900 && ms < 3_000, `tardó ${ms} ms`);
});

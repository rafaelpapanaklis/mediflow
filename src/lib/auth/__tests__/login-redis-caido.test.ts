/**
 * Login rápido (28-oct) — con Redis (Upstash) caído, el login ya no tarda ~22 s.
 *
 * Run: npm run test:login-servidor
 *
 * Antes: `@upstash/redis` reintentaba 5 veces con espera exponencial (~4,4 s por comando) y el POST del
 * login hace 5 comandos en serie antes del fail-open: ~22 s con el botón «Entrando…» (panel.108 apunta a
 * un host que no existe; en producción pasaría si Upstash se cae). Ahora (`@/lib/upstash-rapido`): un
 * reintento a los 50 ms y un tope de 1 s por comando. El fail-open no cambia: se entra igual y el bloqueo
 * por intentos sigue, en memoria.
 *
 * Sin red de verdad: un host `.invalid` (RFC 2606, nunca existe), un puerto que corta la conexión y un
 * servidor local que nunca contesta. Supabase simulado.
 */
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import {
  OPCIONES_UPSTASH_CANDADOS,
  OPCIONES_UPSTASH_RAPIDAS,
  UPSTASH_TIEMPO_MAX_CANDADOS_MS,
  UPSTASH_TIEMPO_MAX_MS,
} from "@/lib/upstash-rapido";

// Antes de la primera llamada a failban: su cliente se crea una vez, con estas variables.
process.env.UPSTASH_REDIS_REST_URL = "https://sin-redis.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";

let respuestaSupabase: { data: { session: unknown }; error: unknown } = { data: { session: {} }, error: null };
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: {
        signOut: async () => ({ error: null }),
        signInWithPassword: async () => respuestaSupabase,
      },
    }),
  },
});

// Import diferido y DESPUÉS del mock (tsx compila a CJS).
const login = async (r: NextRequest) => (await import("../../../app/api/auth/login/route")).POST(r);

function pedir(email: string, ip: string) {
  return new NextRequest("http://dev.local/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "x" }),
    headers: { "content-type": "application/json", host: "dev.local", origin: "http://dev.local", "x-forwarded-for": ip },
  });
}

async function cronometrar<T>(f: () => Promise<T>): Promise<{ valor: T; ms: number }> {
  const t0 = performance.now();
  const valor = await f();
  return { valor, ms: performance.now() - t0 };
}

// Silencia los avisos de fail-open (uno por módulo) para que la salida se lea.
const avisoOriginal = console.warn;
console.warn = () => {};
after(() => { console.warn = avisoOriginal; });

test("🔴 con un host de Redis inexistente, el POST /api/auth/login responde en ~1 s (antes ~22 s) y se entra", async () => {
  respuestaSupabase = { data: { session: {} }, error: null };
  const { valor: r, ms } = await cronometrar(() => login(pedir("dueno@example.com", "198.51.100.20")));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.ok(ms < 1_500, `tardó ${Math.round(ms)} ms`);
});

test("con Redis caído, la contraseña mala sigue siendo 401 rápido, y el bloqueo por cuenta sigue (en memoria)", async () => {
  respuestaSupabase = { data: { session: null }, error: { message: "Invalid login credentials" } };
  const email = "objetivo@example.com";
  for (let i = 0; i < 5; i++) {
    const { valor: r, ms } = await cronometrar(() => login(pedir(email, `203.0.113.${i + 1}`)));
    assert.equal(r.status, 401);
    assert.ok(ms < 1_500, `intento ${i + 1}: ${Math.round(ms)} ms`);
  }
  const sexto = await login(pedir(email, "203.0.113.99"));
  assert.equal(sexto.status, 429, "el fail-open no abre la puerta: el bloqueo cuenta en memoria");
});

test("opciones: un reintento a los 50 ms y señal NUEVA por comando (una fija quedaría abortada para siempre)", () => {
  assert.deepEqual({ ...OPCIONES_UPSTASH_RAPIDAS.retry, backoff: OPCIONES_UPSTASH_RAPIDAS.retry.backoff() }, { retries: 1, backoff: 50 });
  assert.equal(typeof OPCIONES_UPSTASH_RAPIDAS.signal, "function");
  const a = OPCIONES_UPSTASH_RAPIDAS.signal();
  const b = OPCIONES_UPSTASH_RAPIDAS.signal();
  assert.notEqual(a, b);
  assert.equal(a.aborted, false);
  assert.equal(UPSTASH_TIEMPO_MAX_MS, 1_000);
  // v2: los candados contra duplicados, con más margen (los prueba failban-candados-lentos).
  assert.equal(OPCIONES_UPSTASH_CANDADOS.retry.retries, 2);
  assert.equal(UPSTASH_TIEMPO_MAX_CANDADOS_MS, 3_000);
  assert.notEqual(OPCIONES_UPSTASH_CANDADOS.signal(), OPCIONES_UPSTASH_CANDADOS.signal());
});

/** Un servidor local: `corta` cierra cada conexión al llegar; `calla` la deja colgada. */
async function servidor(modo: "corta" | "calla") {
  let conexiones = 0;
  const colgadas: http.ServerResponse[] = [];
  const srv = http.createServer((req, res) => {
    conexiones++;
    if (modo === "corta") req.socket.destroy();
    else colgadas.push(res);
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    conexiones: () => conexiones,
    cerrar: () => new Promise<void>((ok) => { colgadas.forEach((r) => r.destroy()); srv.closeAllConnections(); srv.close(() => ok()); }),
  };
}

test("Redis que corta la conexión: el comando falla (lanza) tras 2 intentos, no 6", async () => {
  const s = await servidor("corta");
  try {
    const redis = new Redis({ url: s.url, token: "t", ...OPCIONES_UPSTASH_RAPIDAS });
    const { valor: error, ms } = await cronometrar(() => redis.get("k").then(() => null, (e: unknown) => e));
    assert.ok(error instanceof Error, "tiene que LANZAR para que quien llama caiga a memoria");
    assert.equal(s.conexiones(), 2);
    assert.ok(ms < 500, `tardó ${Math.round(ms)} ms`);
  } finally {
    await s.cerrar();
  }
});

test("Redis que no contesta: el comando se corta en ~1 s y LANZA (no devuelve «Aborted» como respuesta)", async () => {
  const s = await servidor("calla");
  try {
    const redis = new Redis({ url: s.url, token: "t", ...OPCIONES_UPSTASH_RAPIDAS });
    const { valor: error, ms } = await cronometrar(() => redis.get("k").then((v) => ({ v }), (e: unknown) => e));
    assert.ok(error instanceof Error, `devolvió ${JSON.stringify(error)}`);
    assert.ok(ms >= UPSTASH_TIEMPO_MAX_MS - 50 && ms < UPSTASH_TIEMPO_MAX_MS + 500, `tardó ${Math.round(ms)} ms`);
    // El siguiente comando lleva su propia señal: no sale abortado al instante.
    const segundo = await cronometrar(() => redis.get("k").catch(() => null));
    assert.ok(segundo.ms >= UPSTASH_TIEMPO_MAX_MS - 50, `el segundo tardó ${Math.round(segundo.ms)} ms`);
  } finally {
    await s.cerrar();
  }
});

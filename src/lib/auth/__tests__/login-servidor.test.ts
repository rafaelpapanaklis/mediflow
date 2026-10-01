/**
 * M4 (auditoría 30-sep-2026) — login de clínica en el servidor.
 *
 * Run: npm run test:login-servidor
 *
 * Reproduce el fallo: /api/auth/login-attempt aceptaba `fail` y `success` SIN
 * sesión. Seis `fail` con el correo del dueño lo dejaban fuera (429 en
 * `check`), y un `success` borraba el bloqueo de cualquier cuenta.
 *
 * Y fija el login nuevo (POST /api/auth/login, Supabase simulado):
 *   · mismo mensaje para cuenta inexistente, contraseña mala y correo sin confirmar;
 *   · bloqueo por CUENTA al 5.º fallo aunque cambie la IP;
 *   · F3 (revisión en panel.108, 1-oct): 5 fallos de A NO bloquean a B desde la misma IP
 *     (una clínica sale por una sola IP); muchas cuentas distintas fallidas desde una IP
 *     sí frenan esa IP, salvo a quien ya entró bien desde ahí; el bloqueo de A expira;
 *   · el acierto limpia el contador; no se llama a Supabase si está bloqueado;
 *   · otro origen (CSRF de login) no entra.
 *
 * Sin Upstash (sin .env): failban usa su respaldo en memoria, que es la misma lógica.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let llamadasSupabase = 0;
let respuestaSupabase: { data: { session: unknown }; error: unknown } = { data: { session: null }, error: { message: "Invalid login credentials" } };

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: {
        signOut: async () => ({ error: null }),
        signInWithPassword: async () => { llamadasSupabase++; return respuestaSupabase; },
      },
    }),
  },
});

// Import diferido (sin top-level await: tsx compila a CJS) y DESPUÉS del mock.
const rutaLogin = () => import("../../../app/api/auth/login/route");
const rutaAttempt = () => import("../../../app/api/auth/login-attempt/route");
const nucleo = () => import("../login-servidor");
const login = async (r: NextRequest) => (await rutaLogin()).POST(r);
const loginAttempt = async (r: NextRequest) => (await rutaAttempt()).POST(r);

function pedir(url: string, body: unknown, ip: string, extra: Record<string, string> = {}) {
  return new NextRequest(`http://dev.local${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "dev.local", origin: "http://dev.local", "x-forwarded-for": ip, ...extra },
  });
}

test("login-attempt: `fail` sin sesión ya no cuenta (antes 6 dejaban fuera al dueño)", async () => {
  const email = "dueno-victima@example.com";
  for (let i = 0; i < 6; i++) {
    const r = await loginAttempt(pedir("/api/auth/login-attempt", { phase: "fail", email }, "203.0.113.9"));
    assert.equal(r.status, 410);
  }
  const check = await loginAttempt(pedir("/api/auth/login-attempt", { phase: "check", email }, "198.51.100.1"));
  assert.equal(check.status, 200, "el dueño no debe quedar bloqueado por fallos que nadie intentó");
});

test("login-attempt: `success` sin sesión ya no limpia el bloqueo de nadie", async () => {
  const r = await loginAttempt(pedir("/api/auth/login-attempt", { phase: "success", email: "x@example.com" }, "203.0.113.10"));
  assert.equal(r.status, 410);
});

test("login: mismo mensaje para todo error de Supabase (no revela si el correo existe)", async () => {
  for (const error of [{ message: "Invalid login credentials" }, { message: "Email not confirmed" }, { message: "User not found" }]) {
    respuestaSupabase = { data: { session: null }, error };
    const r = await login(pedir("/api/auth/login", { email: `a${Math.random()}@example.com`, password: "x" }, `192.0.2.${Math.floor(Math.random() * 200)}`));
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: (await nucleo()).MENSAJE_CREDENCIALES });
  }
});

test("login: bloquea la CUENTA al 5.º fallo aunque cada intento venga de otra IP, y no llama a Supabase", async () => {
  respuestaSupabase = { data: { session: null }, error: { message: "Invalid login credentials" } };
  const email = "objetivo@example.com";
  for (let i = 0; i < 5; i++) {
    const r = await login(pedir("/api/auth/login", { email, password: `mala${i}` }, `10.0.0.${i + 1}`));
    assert.equal(r.status, 401);
  }
  const antes = llamadasSupabase;
  const r = await login(pedir("/api/auth/login", { email: "  OBJETIVO@example.com ", password: "la-buena" }, "10.0.0.99"));
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("Retry-After"));
  assert.equal(llamadasSupabase, antes, "bloqueado no debe ni preguntar a Supabase");
});

const MALA = { data: { session: null }, error: { message: "Invalid login credentials" } };
const BUENA = { data: { session: { access_token: "t" } }, error: null };

test("F3: 5 fallos de A no bloquean a B desde la misma IP (la recepcionista no deja fuera al doctor)", async () => {
  const ip = "198.18.0.7";
  respuestaSupabase = MALA;
  for (let i = 0; i < 5; i++) {
    const r = await login(pedir("/api/auth/login", { email: "inventado@example.com", password: `mala${i}` }, ip));
    assert.equal(r.status, 401);
  }
  // A sí queda bloqueada, con un mensaje que dice que es ESTE correo.
  const a = await login(pedir("/api/auth/login", { email: "inventado@example.com", password: "otra" }, ip));
  assert.equal(a.status, 429);
  assert.match((await a.json()).error, /con este correo/);

  // B, desde la misma IP: su login correcto pasa…
  respuestaSupabase = BUENA;
  const b = await login(pedir("/api/auth/login", { email: "doctor@example.com", password: "buena" }, ip));
  assert.equal(b.status, 200);
  // …y si se equivoca recibe el 401 normal, no un 429.
  respuestaSupabase = MALA;
  const b2 = await login(pedir("/api/auth/login", { email: "doctor@example.com", password: "mala" }, ip));
  assert.equal(b2.status, 401);
});

test("F3: muchas cuentas distintas fallidas desde una IP frenan esa IP (y solo esa)", async () => {
  const ip = "198.18.0.8";
  const { POLITICA_IP } = await import("../login-bloqueo");
  // Antes del ataque, el doctor entra bien desde esta IP: queda «conocido» aquí.
  respuestaSupabase = BUENA;
  assert.equal((await login(pedir("/api/auth/login", { email: "dr-conocido@example.com", password: "buena" }, ip))).status, 200);

  respuestaSupabase = MALA;
  for (let i = 0; i < POLITICA_IP.threshold; i++) {
    const r = await login(pedir("/api/auth/login", { email: `victima${i}@example.com`, password: "x" }, ip));
    assert.equal(r.status, 401, `el fallo ${i + 1} todavía responde 401`);
  }
  // Una cuenta nueva desde esa IP: 429 con el mensaje de la red, sin preguntar a Supabase.
  respuestaSupabase = BUENA;
  const antes = llamadasSupabase;
  const r = await login(pedir("/api/auth/login", { email: "nueva@example.com", password: "buena" }, ip));
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("Retry-After")) > 0);
  assert.match((await r.json()).error, /desde esta red/i);
  assert.equal(llamadasSupabase, antes);

  // Quien ya había entrado bien desde esa IP sigue entrando.
  assert.equal((await login(pedir("/api/auth/login", { email: "dr-conocido@example.com", password: "buena" }, ip))).status, 200);
  // Y la misma cuenta nueva desde otra IP entra sin problema.
  assert.equal((await login(pedir("/api/auth/login", { email: "nueva@example.com", password: "buena" }, "198.18.0.9"))).status, 200);
});

test("F3: equivocarse muchas veces con el MISMO correo no frena la IP", async () => {
  const ip = "198.18.0.10";
  respuestaSupabase = MALA;
  // Tres personas se equivocan cada una hasta quedar bloqueadas (y siguen insistiendo).
  for (const quien of ["recep1@example.com", "recep2@example.com", "recep3@example.com"]) {
    for (let i = 0; i < 8; i++) await login(pedir("/api/auth/login", { email: quien, password: "mala" }, ip));
  }
  respuestaSupabase = BUENA;
  assert.equal((await login(pedir("/api/auth/login", { email: "doctora@example.com", password: "buena" }, ip))).status, 200);
});

test("F3: el bloqueo de A expira (y el de la IP también)", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const ip = "198.18.0.11";
    respuestaSupabase = MALA;
    for (let i = 0; i < 5; i++) await login(pedir("/api/auth/login", { email: "a-expira@example.com", password: "mala" }, ip));
    respuestaSupabase = BUENA;
    const bloqueada = await login(pedir("/api/auth/login", { email: "a-expira@example.com", password: "buena" }, ip));
    assert.equal(bloqueada.status, 429);
    assert.match((await bloqueada.json()).error, /Espera 1 minuto/);
    mock.timers.tick(61_000);
    assert.equal((await login(pedir("/api/auth/login", { email: "a-expira@example.com", password: "buena" }, ip))).status, 200);

    const { POLITICA_IP } = await import("../login-bloqueo");
    const ip2 = "198.18.0.12";
    respuestaSupabase = MALA;
    for (let i = 0; i < POLITICA_IP.threshold; i++) await login(pedir("/api/auth/login", { email: `exp${i}@example.com`, password: "x" }, ip2));
    respuestaSupabase = BUENA;
    assert.equal((await login(pedir("/api/auth/login", { email: "luego@example.com", password: "buena" }, ip2))).status, 429);
    mock.timers.tick(POLITICA_IP.lockSec * 1000 + 1000);
    assert.equal((await login(pedir("/api/auth/login", { email: "luego@example.com", password: "buena" }, ip2))).status, 200);
  } finally {
    mock.timers.reset();
  }
});

test("login: el acierto limpia el contador de esa cuenta", async () => {
  const email = "buena@example.com";
  respuestaSupabase = { data: { session: null }, error: { message: "Invalid login credentials" } };
  for (let i = 0; i < 4; i++) await login(pedir("/api/auth/login", { email, password: "mala" }, "100.64.0.1"));
  respuestaSupabase = { data: { session: { access_token: "t" } }, error: null };
  const ok = await login(pedir("/api/auth/login", { email, password: "buena" }, "100.64.0.1"));
  assert.equal(ok.status, 200);
  respuestaSupabase = { data: { session: null }, error: { message: "Invalid login credentials" } };
  const r = await login(pedir("/api/auth/login", { email, password: "mala" }, "100.64.0.1"));
  assert.equal(r.status, 401, "tras el acierto vuelve a tener 5 intentos");
});

test("login: otro origen no entra (CSRF de login) y el cuerpo raro es 400", async () => {
  const r = await login(pedir("/api/auth/login", { email: "a@example.com", password: "x" }, "100.64.0.2", { origin: "https://malo.example" }));
  assert.equal(r.status, 403);
  const r2 = await login(pedir("/api/auth/login", { email: "no-es-correo", password: "x" }, "100.64.0.3"));
  assert.equal(r2.status, 400);
});

test("núcleo: leerEntradaLogin normaliza y acota; mismoOrigen compara con Host", async () => {
  const { leerEntradaLogin, mismoOrigen } = await nucleo();
  assert.deepEqual(leerEntradaLogin({ email: " A@B.co ", password: "p" }), { ok: true, email: "a@b.co", password: "p" });
  assert.equal(leerEntradaLogin({ email: "a@b.co", password: "x".repeat(2000) }).ok, false);
  assert.equal(leerEntradaLogin(null).ok, false);
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(mismoOrigen(h({ host: "x.io", origin: "https://x.io" })), true);
  assert.equal(mismoOrigen(h({ host: "x.io", referer: "https://x.io/login" })), true);
  assert.equal(mismoOrigen(h({ host: "x.io" })), false);
  assert.equal(mismoOrigen(h({ host: "x.io", origin: "https://y.io" })), false);
});

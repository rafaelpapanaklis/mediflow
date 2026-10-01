/**
 * ws1-t8 · M3 — límite de intentos del 2FA POR CUENTA y código TOTP de un solo
 * uso.
 *
 * Run: npm run test:2fa-intentos
 *
 * Sin Upstash (como aquí) failban cae a memoria: la lógica de llaves es la
 * misma que en producción, que es lo que se fija. Lo que antes fallaba:
 *   · el límite era por IP: cambiando de IP se tenían intentos nuevos;
 *   · cada ruta tenía el suyo: verify, disable y recovery-codes sumaban;
 *   · un mismo código TOTP servía varias veces durante su ventana.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { authenticator } from "otplib";
import {
  consumirTotp,
  limitar2faPorCuenta,
  limitar2faPorIp,
  LIMITES_2FA,
  pasoTotp,
} from "../two-factor-intentos";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

function req(ruta: string, ip: string): NextRequest {
  return new NextRequest(`http://localhost${ruta}`, { method: "POST", headers: { "x-forwarded-for": ip } });
}

test("el presupuesto es de la CUENTA: cambiar de IP no da intentos nuevos", async () => {
  const cuenta = "sb-cuenta-ip";
  for (let i = 0; i < LIMITES_2FA.cuenta15m.limit; i++) {
    assert.equal(await limitar2faPorCuenta(req("/api/auth/2fa/verify", `10.0.0.${i}`), cuenta), null, `intento ${i + 1}`);
  }
  const corte = await limitar2faPorCuenta(req("/api/auth/2fa/verify", "10.9.9.9"), cuenta);
  assert.equal(corte?.status, 429, "desde otra IP, la misma cuenta ya no tiene intentos");
  assert.ok(corte?.headers.get("Retry-After"));
});

test("verify, disable, enable y recovery-codes comparten el mismo presupuesto", async () => {
  const cuenta = "sb-cuenta-rutas";
  const rutas = ["/api/auth/2fa/verify", "/api/auth/2fa/disable", "/api/auth/2fa/recovery-codes", "/api/auth/2fa/enable"];
  for (let i = 0; i < LIMITES_2FA.cuenta15m.limit; i++) {
    assert.equal(await limitar2faPorCuenta(req(rutas[i % rutas.length], "10.1.1.1"), cuenta), null);
  }
  assert.equal((await limitar2faPorCuenta(req("/api/auth/2fa/disable", "10.1.1.1"), cuenta))?.status, 429);
});

test("otra persona no hereda el bloqueo de la primera", async () => {
  const a = "sb-bloqueada";
  for (let i = 0; i < LIMITES_2FA.cuenta15m.limit + 1; i++) await limitar2faPorCuenta(req("/api/auth/2fa/verify", "10.2.2.2"), a);
  assert.equal(await limitar2faPorCuenta(req("/api/auth/2fa/verify", "10.2.2.2"), "sb-otra"), null);
});

test("el techo por dia es mas alto que el de 15 min y ambos son por cuenta", () => {
  assert.ok(LIMITES_2FA.cuentaDia.limit > LIMITES_2FA.cuenta15m.limit);
  assert.equal(LIMITES_2FA.cuentaDia.windowSec, 24 * 60 * 60);
  assert.ok(LIMITES_2FA.cuenta15m.limit >= 5, "el humano que se equivoca cinco veces no choca");
});

test("el freno por IP es generoso: una oficina con varias personas no se bloquea por el", async () => {
  for (let i = 0; i < 25; i++) assert.equal(await limitar2faPorIp(req("/api/auth/2fa/verify", "10.3.3.3")), null);
});

// ── TOTP de un solo uso ──────────────────────────────────────────────

test("un codigo TOTP valido entra una vez; la segunda vez es «reusado»", async () => {
  const secret = authenticator.generateSecret();
  const code = authenticator.generate(secret);
  assert.equal(await consumirTotp("sb-totp", code, secret), "ok");
  assert.equal(await consumirTotp("sb-totp", code, secret), "reusado");
});

test("el codigo usado por una persona no le estorba a otra con su propio secreto", async () => {
  const s1 = authenticator.generateSecret();
  const s2 = authenticator.generateSecret();
  assert.equal(await consumirTotp("sb-uno", authenticator.generate(s1), s1), "ok");
  assert.equal(await consumirTotp("sb-dos", authenticator.generate(s2), s2), "ok");
});

test("codigo incorrecto, vacio o con formato de recuperacion: «incorrecto», sin marcar nada", async () => {
  const secret = authenticator.generateSecret();
  assert.equal(await consumirTotp("sb-x", "000000", secret) === "ok", false);
  assert.equal(await consumirTotp("sb-x", "", secret), "incorrecto");
  assert.equal(await consumirTotp("sb-x", "abcde-fghjk", secret), "incorrecto");
  assert.equal(pasoTotp("123456", ""), null);
});

test("el paso del codigo es el contador de 30 s (con la tolerancia de ±1)", () => {
  const secret = authenticator.generateSecret();
  const code = authenticator.generate(secret);
  const paso = pasoTotp(code, secret);
  const ahora = Math.floor(Date.now() / 30000);
  assert.ok(paso !== null && Math.abs(paso - ahora) <= 1);
});

// ── Las rutas usan esto, no el limitador en memoria ──────────────────

test("ninguna ruta de /api/auth/2fa que valida codigos usa el rateLimit en memoria ni verifyTotp a secas", () => {
  const raiz = join(__dirname, "../../../app/api/auth/2fa");
  for (const r of ["verify", "enable", "disable", "recovery-codes"]) {
    const src = readFileSync(join(raiz, r, "route.ts"), "utf8");
    assert.doesNotMatch(src, /from "@\/lib\/rate-limit"/, `${r}: sigue con el límite en memoria por IP`);
    assert.doesNotMatch(src, /\bverifyTotp\(/, `${r}: valida el TOTP sin marcarlo usado`);
    assert.match(src, /limitar2faPorCuenta\(req, actor\.supabaseId\)/, `${r}: sin límite por cuenta`);
    assert.match(src, /consumirTotp\(actor\.supabaseId/, `${r}: sin TOTP de un solo uso`);
  }
  const setup = readFileSync(join(raiz, "setup", "route.ts"), "utf8");
  assert.doesNotMatch(setup, /from "@\/lib\/rate-limit"/);
  assert.match(setup, /limitar2faSetup\(req, actor\.supabaseId\)/);
});

/**
 * Login rápido v2 (m-1 de la revisión de t8) — con Upstash LENTO (vivo, pero tarda 1,5 s), los candados
 * contra duplicados (`acquireLock`/`releaseLock`: envío del inbox, turno del bot, lead público, TOTP,
 * DICOM, cobro) esperan la respuesta buena; el rate-limit y el bloqueo de intentos no esperan (1 s y a
 * memoria). En v1 los dos usaban el cliente de 1 s: el candado se abría por timeout (fail-open) y un
 * doble clic en «Enviar» mandaba el WhatsApp dos veces.
 *
 * Run: npm run test:login-servidor
 *
 * Un Upstash de mentira en 127.0.0.1 que contesta como el de verdad (base64), tarde.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { UPSTASH_TIEMPO_MAX_CANDADOS_MS, UPSTASH_TIEMPO_MAX_MS } from "@/lib/upstash-rapido";

const LENTO_MS = 1_500; // más que el tope del cliente rápido, menos que el de los candados
const MUY_LENTO_MS = 4_000; // más que el tope de los candados
const claves = new Map<string, string>();
const comandos: string[] = [];
const b64 = (s: string) => Buffer.from(s).toString("base64");

/** Un comando de Redis, como lo resolvería Upstash (resultado en base64 donde toca). */
function ejecutar(cmd: unknown[]): unknown {
  const [nombre, clave] = [String(cmd[0] ?? "").toLowerCase(), String(cmd[1] ?? "")];
  comandos.push(`${nombre} ${clave}`);
  if (nombre === "set") {
    // SET NX: «OK» la primera vez, null si ya estaba.
    if (claves.has(clave)) return null;
    claves.set(clave, String(cmd[2]));
    return b64("OK");
  }
  if (nombre === "eval") {
    const k = String(cmd[3]);
    if (claves.get(k) !== String(cmd[4])) return 0;
    claves.delete(k);
    return 1;
  }
  return null;
}

// El cliente agrupa los comandos (auto-pipeline): POST /pipeline con [[cmd…], …] → [{ result }, …].
// Suelto: POST / con [cmd…] → { result }.
const srv = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (c) => (cuerpo += c));
  req.on("end", () => {
    const enLote = req.url?.startsWith("/pipeline") ?? false;
    const lote = (enLote ? JSON.parse(cuerpo) : [JSON.parse(cuerpo)]) as unknown[][];
    const salida = lote.map((cmd) => ({ result: ejecutar(cmd) }));
    const espera = lote.some((cmd) => String(cmd[1] ?? "").includes("muy-lento")) ? MUY_LENTO_MS : LENTO_MS;
    const t = setTimeout(() => {
      if (!res.destroyed) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(enLote ? salida : salida[0]));
    }, espera);
    res.on("close", () => clearTimeout(t));
  });
});

const avisoOriginal = console.warn;
before(async () => {
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
  console.warn = () => {};
});
after(async () => {
  console.warn = avisoOriginal;
  srv.closeAllConnections();
  await new Promise<void>((ok) => srv.close(() => ok()));
});

const failban = () => import("../failban");
async function cronometrar<T>(f: () => Promise<T>): Promise<{ valor: T; ms: number }> {
  const t0 = performance.now();
  const valor = await f();
  return { valor, ms: performance.now() - t0 };
}

test("🔴 candado con Upstash lento: el primero lo toma y el segundo NO (espera la respuesta, no se abre por timeout)", async () => {
  const { acquireLock } = await failban();
  const primero = await cronometrar(() => acquireLock("inbox:envio-1", 60, "peticion-a"));
  assert.equal(primero.valor, true);
  assert.ok(primero.ms >= LENTO_MS - 50 && primero.ms < UPSTASH_TIEMPO_MAX_CANDADOS_MS - 200, `esperó la respuesta (no el tope): ${Math.round(primero.ms)} ms`);
  assert.equal(claves.get("fb:job:inbox:envio-1"), "peticion-a", "lo tomó en Redis, no por fail-open");
  const segundo = await cronometrar(() => acquireLock("inbox:envio-1", 60, "peticion-b"));
  assert.equal(segundo.valor, false, "el doble clic no pasa: en v1 daba true por el timeout de 1 s");
  assert.equal(comandos.filter((c) => c === "set fb:job:inbox:envio-1").length, 2, "una vez cada uno, sin reintentos");
});

test("releaseLock con dueño también espera la respuesta (lo suelta de verdad)", async () => {
  const { acquireLock, releaseLock } = await failban();
  const { ms } = await cronometrar(() => releaseLock("inbox:envio-1", "peticion-a"));
  assert.ok(ms >= LENTO_MS - 50, `${Math.round(ms)} ms`);
  assert.equal(claves.has("fb:job:inbox:envio-1"), false);
  assert.equal(await acquireLock("inbox:envio-1", 60, "peticion-c"), true, "suelto: el siguiente lo toma");
});

test("🔴 con el MISMO Upstash lento, el rate-limit del login no espera: ~1 s y a memoria", async () => {
  const { persistentRateLimitKey } = await failban();
  const { valor, ms } = await cronometrar(() => persistentRateLimitKey("login:ip:198.51.100.7", 60));
  assert.equal(valor, true, "fail-open: pasa con la cuenta en memoria");
  assert.ok(ms < UPSTASH_TIEMPO_MAX_MS + 300, `${Math.round(ms)} ms`);
});

test("el candado tiene tope: si Upstash tarda más de 3 s, se abre (fail-open, como siempre)", async () => {
  const { acquireLock } = await failban();
  const { valor, ms } = await cronometrar(() => acquireLock("muy-lento", 60));
  assert.equal(valor, true);
  assert.ok(ms >= UPSTASH_TIEMPO_MAX_CANDADOS_MS - 50 && ms < UPSTASH_TIEMPO_MAX_CANDADOS_MS + 500, `${Math.round(ms)} ms`);
});

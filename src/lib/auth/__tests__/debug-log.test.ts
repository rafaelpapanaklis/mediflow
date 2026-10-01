/**
 * H15 / [AUTH-DEBUG] (auditoría 30-sep-2026): en producción la resolución de
 * sesión no imprime el clinicId de nadie.
 *
 * Run: npm run test:seguridad-rapidos
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { authDebug } from "../debug-log";

function capturando(env: string, fn: () => void): string[] {
  const antes = process.env.NODE_ENV;
  const log = console.log;
  const warn = console.warn;
  const salida: string[] = [];
  (process.env as Record<string, string>).NODE_ENV = env;
  console.log = (...a: unknown[]) => { salida.push(a.join(" ")); };
  console.warn = (...a: unknown[]) => { salida.push(a.join(" ")); };
  try { fn(); } finally {
    console.log = log;
    console.warn = warn;
    (process.env as Record<string, string | undefined>).NODE_ENV = antes;
  }
  return salida;
}

test("en producción authDebug no imprime nada", () => {
  const s = capturando("production", () => {
    authDebug("log", "[AUTH-DEBUG x]", JSON.stringify({ picked: "clinica-123" }));
    authDebug("warn", "[AUTH-DEBUG y]", JSON.stringify({ requested: "clinica-9" }));
  });
  assert.deepEqual(s, []);
});

test("en desarrollo sí imprime (log y warn)", () => {
  const s = capturando("development", () => {
    authDebug("log", "[AUTH-DEBUG x]", "a");
    authDebug("warn", "[AUTH-DEBUG y]", "b");
  });
  assert.equal(s.length, 2);
});

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "__tests__") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, acc);
    else if (/\.(ts|tsx)$/.test(p)) acc.push(p);
  }
  return acc;
}

test("ningún console.log/warn directo imprime [AUTH-DEBUG] en src", () => {
  const malos: string[] = [];
  for (const f of archivos(join(process.cwd(), "src"))) {
    if (f.endsWith("debug-log.ts")) continue;
    const src = readFileSync(f, "utf8");
    if (/console\.(log|warn|error|info)\(\s*["'`]\[AUTH-DEBUG/.test(src)) malos.push(f);
  }
  assert.deepEqual(malos, []);
});

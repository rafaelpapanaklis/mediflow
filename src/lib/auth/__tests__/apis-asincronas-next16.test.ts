/**
 * Next 16 (ws1-t5): cookies(), headers(), draftMode() y los helpers de sesión que
 * dependen de ellos son ASÍNCRONOS. Con `strict: false` TypeScript no avisa de una
 * promesa usada como booleano (`if (esServerAction())` siempre sería verdadero) ni
 * de `const { decision } = decidirDosPasos(u)` salvo que el tipo no encaje, y un
 * `await` olvidado en el gate de 2FA lo dejaría abierto sin ningún error.
 *
 * Esta prueba barre src/ y falla ante cualquier llamada sin `await` a esas
 * funciones. Run: npm run test:next16-asincronas
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === "__tests__" || n === "node_modules") continue;
      archivos(p, salida);
    } else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) salida.push(p);
  }
  return salida;
}

// Funciones que ahora devuelven promesa: nombre → una llamada sin await.
const ASINCRONAS = [
  "cookies",
  "headers",
  "draftMode",
  "readActiveClinicCookie",
  "resembrarActiveClinicCookie",
  "decidirDosPasos",
  "hasValidTwoFactorCookie",
  "hasValidVerComoCookie",
  "readBranchCookie",
  "readEduCampusCookie",
  "getPortalSession",
  "enforceTwoFactorGate",
  "enforceApiPlanGate",
];

function sinAwait(fuente: string, nombre: string): string[] {
  const malas: string[] = [];
  const re = new RegExp(`(?<![\\w.$])${nombre}\\(`, "g");
  for (const crudo of fuente.split("\n")) {
    const linea = crudo.replace(/\s\/\/ .*$/, ""); // comentario al final de la línea
    const t = linea.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(linea))) {
      const antes = linea.slice(0, m.index);
      if (/\b(?:async\s+)?function\s+$/.test(antes)) continue; // la definición
      if (/\bawait\s+\(?$/.test(antes)) continue;
      if (/\breturn\s+$/.test(antes) || /=>\s*$/.test(antes)) continue; // se devuelve la promesa tal cual
      if (/\.then\($/.test(antes)) continue;
      malas.push(t);
    }
  }
  return malas;
}

test("ninguna llamada sin await a cookies()/headers()/helpers de sesión asíncronos", () => {
  const fallas: string[] = [];
  for (const f of archivos(RAIZ)) {
    const fuente = readFileSync(f, "utf8");
    for (const nombre of ASINCRONAS) {
      if (!fuente.includes(`${nombre}(`)) continue;
      for (const l of sinAwait(fuente, nombre)) fallas.push(`${relative(RAIZ, f)} · ${nombre}: ${l.slice(0, 120)}`);
    }
  }
  assert.deepEqual(fallas, [], `llamadas sin await:\n${fallas.join("\n")}`);
});

test("createClient() de supabase/server siempre con await", () => {
  const fallas: string[] = [];
  for (const f of archivos(RAIZ)) {
    const fuente = readFileSync(f, "utf8");
    if (!/from\s+["']@\/lib\/supabase\/server["']/.test(fuente) && !fuente.includes('import("@/lib/supabase/server")')) continue;
    if (f.endsWith(join("lib", "supabase", "server.ts"))) continue;
    const alias = /import\s*\{[^}]*createClient as (\w+)[^}]*\}\s*from\s*["']@\/lib\/supabase\/server["']/.exec(fuente)?.[1] ?? "createClient";
    for (const l of sinAwait(fuente, alias)) fallas.push(`${relative(RAIZ, f)} · ${l.slice(0, 120)}`);
  }
  assert.deepEqual(fallas, [], `createClient() sin await:\n${fallas.join("\n")}`);
});

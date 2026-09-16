/**
 * Rediseño de Analítica (ws1-t4) — candados.
 *
 * Run: npx tsx --test src/components/dashboard/analitica-rediseno/__tests__/analitica-rediseno.test.ts
 *
 * Lo que fija:
 *  - Las pestañas del marco nuevo son EXACTAMENTE las del marco de hoy
 *    (`analytics-layout.tsx`): mismos ids, rutas, llaves y orden. Ni una
 *    sección inventada ni una perdida.
 *  - Cada una de las nueve páginas lee el interruptor `menu-dos-niveles` y se
 *    lo pasa a su cliente; cada cliente lo respeta con un `if (rediseno)`.
 *    Apagado, el JSX de siempre se pinta tal cual.
 *  - Ni una monoespaciada en el paquete: cifras con tabular-nums sobre
 *    Instrument Sans.
 *  - El CSS del paquete no trae ningún color en hex: todo sale de los tokens
 *    del menú (`--m2-*`) o de los semánticos globales.
 *  - Toda llave i18n que nombra el paquete existe en español y en inglés.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PESTANAS, pestanaActiva } from "../pestanas";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const PAQUETE = join(RAIZ, "src", "components", "dashboard", "analitica-rediseno");
const RUTAS = join(RAIZ, "src", "app", "dashboard", "analytics");

const SUBRUTAS = ["costs", "crm", "doctors", "journey", "no-shows", "occupancy", "procedures", "waiting-room"];

function archivosDe(dir: string, filtro: (n: string) => boolean): string[] {
  return readdirSync(dir)
    .filter(filtro)
    .map((n) => join(dir, n));
}

// ═══ Las nueve pestañas ══════════════════════════════════════════════

test("las pestañas del marco nuevo son las del marco de hoy, en el mismo orden", () => {
  const viejo = readFileSync(join(RAIZ, "src", "components", "dashboard", "analytics", "analytics-layout.tsx"), "utf8");
  const bloque = viejo.slice(viejo.indexOf("const TABS"), viejo.indexOf("];", viejo.indexOf("const TABS")));
  const re = /id:\s*"([^"]+)",\s*labelKey:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g;
  const hoy: Array<{ id: string; labelKey: string; href: string }> = [];
  for (const m of bloque.matchAll(re)) hoy.push({ id: m[1]!, labelKey: m[2]!, href: m[3]! });
  assert.equal(hoy.length, 9, "el marco de hoy tiene nueve pestañas");
  assert.deepEqual([...PESTANAS], hoy);
});

test("solo Resumen exige la ruta exacta; el resto acepta sus subrutas", () => {
  assert.equal(pestanaActiva("/dashboard/analytics", "/dashboard/analytics"), true);
  assert.equal(pestanaActiva("/dashboard/analytics", "/dashboard/analytics/costs"), false);
  assert.equal(pestanaActiva("/dashboard/analytics/costs", "/dashboard/analytics/costs"), true);
  assert.equal(pestanaActiva("/dashboard/analytics/costs", "/dashboard/analytics"), false);
});

// ═══ La bandera en las nueve páginas ═════════════════════════════════

test("cada página lee el interruptor y se lo pasa al cliente", () => {
  const paginas = [join(RUTAS, "page.tsx"), ...SUBRUTAS.map((r) => join(RUTAS, r, "page.tsx"))];
  for (const p of paginas) {
    const src = readFileSync(p, "utf8");
    assert.ok(src.includes("menuDosNivelesEncendido("), `${p} lee el interruptor`);
    assert.ok(src.includes("rediseno={rediseno}"), `${p} pasa rediseno al cliente`);
  }
});

test("cada cliente respeta la bandera con un solo if y una vista propia", () => {
  const clientes = [join(RUTAS, "overview-client.tsx"), ...SUBRUTAS.map((r) => join(RUTAS, r, `${r}-client.tsx`))];
  for (const c of clientes) {
    const src = readFileSync(c, "utf8");
    assert.ok(/if \(rediseno\)/.test(src), `${c} tiene el if (rediseno)`);
    assert.ok(/rediseno = false/.test(src), `${c} apaga el rediseño por defecto`);
    const vista = c.replace("-client.tsx", "-rediseno.tsx");
    assert.ok(existsSync(vista), `${vista} existe`);
  }
});

// ═══ Tipografía y color ══════════════════════════════════════════════

test("ni una monoespaciada en el paquete ni en las vistas", () => {
  const archivos = [
    ...archivosDe(PAQUETE, (n) => /\.(tsx?|css)$/.test(n)),
    ...archivosDe(RUTAS, (n) => n.endsWith("-rediseno.tsx")),
    ...SUBRUTAS.flatMap((r) => archivosDe(join(RUTAS, r), (n) => n.endsWith("-rediseno.tsx"))),
  ];
  assert.ok(archivos.length >= 14, "hay paquete y nueve vistas");
  for (const a of archivos) {
    const src = readFileSync(a, "utf8");
    assert.ok(!/font-mono|monospace/.test(src), `${a} no usa monoespaciada`);
  }
});

test("el CSS del paquete no trae colores en hex", () => {
  const css = readFileSync(join(PAQUETE, "analitica.module.css"), "utf8");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "todo color sale de un token");
  assert.ok(css.includes("var(--m2-activo)"), "usa el violeta del menú");
  assert.ok(css.includes("tabular-nums"), "cifras con tabular-nums");
});

// ═══ i18n ═══════════════════════════════════════════════════════════

test("toda llave i18n del paquete y las vistas existe en es y en", () => {
  const es = JSON.parse(readFileSync(join(RAIZ, "src", "i18n", "dictionaries", "es.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(RAIZ, "src", "i18n", "dictionaries", "en.json"), "utf8"));
  const tiene = (dic: Record<string, unknown>, llave: string) =>
    llave.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dic) !== undefined;
  const archivos = [
    ...archivosDe(PAQUETE, (n) => n.endsWith(".tsx") || n.endsWith(".ts")),
    ...archivosDe(RUTAS, (n) => n.endsWith("-rediseno.tsx")),
    ...SUBRUTAS.flatMap((r) => archivosDe(join(RUTAS, r), (n) => n.endsWith("-rediseno.tsx"))),
  ];
  const llaves = new Set<string>();
  for (const a of archivos) {
    for (const m of readFileSync(a, "utf8").matchAll(/\bt\("([a-zA-Z0-9.]+)"/g)) llaves.add(m[1]!);
    for (const m of readFileSync(a, "utf8").matchAll(/labelKey:\s*"([a-zA-Z0-9.]+)"/g)) llaves.add(m[1]!);
  }
  llaves.delete("CRM"); // sin llave a propósito: el motor devuelve "CRM" tal cual
  assert.ok(llaves.size > 40, `se encontraron llaves (${llaves.size})`);
  for (const k of llaves) {
    assert.ok(tiene(es, k), `es.json tiene ${k}`);
    assert.ok(tiene(en, k), `en.json tiene ${k}`);
  }
});

// Prueba del guardia de "use server" (ws1-t5). Run: npm run test:use-server
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { revisar, exportsDe, tieneUseServer } = require("./use-server-guard.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "use-server-guard-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
function escribir(nombre, texto) {
  const p = path.join(dir, nombre);
  fs.writeFileSync(p, texto);
  return p;
}
const malos = (p) => [...exportsDe(p)].filter(([, k]) => k !== "async").map(([n]) => n).sort();

test("solo funciones async: sin hallazgos (tipos e interfaces no cuentan)", () => {
  const p = escribir("ok.ts", `"use server";
export type A = { a: 1 };
export interface B { b: string }
export async function f() {}
export const g = async () => 1;
export const h = async function () {};
async function i() {}
export { i };
`);
  assert.deepEqual(malos(p), []);
});

test("objeto, constante, enum, clase y función síncrona se detectan", () => {
  const p = escribir("mal.ts", `"use server";
export const LABELS = { a: "x" };
export const N = 3;
export function sincrona() { return 1; }
export const flecha = () => 1;
export enum E { A }
export class C {}
`);
  assert.deepEqual(malos(p), ["C", "E", "LABELS", "N", "flecha", "sincrona"]);
});

test("re-export de algo importado: se marca (el caso de lab-orders / onboarding)", () => {
  escribir("origen.ts", `export const LABELS = { a: 1 };\nexport function sync() {}\nexport async function ok() {}\n`);
  const p = escribir("reexp.ts", `"use server";
import { LABELS, sync } from "./origen";
export { LABELS, sync };
export async function usa() { return LABELS; }
`);
  assert.deepEqual(malos(p), ["LABELS", "sync"]);
});

test("export { x } from y y export * from y arrastran lo que haya en y", () => {
  const p = escribir("barril.ts", `"use server";
export { LABELS, ok } from "./origen";
`);
  assert.deepEqual(malos(p), ["LABELS"]);
  const q = escribir("estrella.ts", `"use server";
export * from "./origen";
`);
  assert.deepEqual(malos(q), ["LABELS", "sync"]);
});

test("un re-export de solo tipos no cuenta", () => {
  escribir("tipos.ts", `export type T = string;\nexport interface I { a: 1 }\n`);
  const p = escribir("soloTipos.ts", `"use server";
export type { T } from "./tipos";
export * from "./tipos";
export async function f() {}
`);
  assert.deepEqual(malos(p), []);
});

test("la directiva solo vale al principio del archivo", () => {
  const con = escribir("con.ts", `// comentario\n"use server";\nexport const X = 1;\n`);
  const sin = escribir("sin.ts", `import x from "./origen";\n"use server";\nexport const X = 1;\n`);
  const fs2 = (p) => require("typescript").createSourceFile(p, fs.readFileSync(p, "utf8"), 99, true);
  assert.equal(tieneUseServer(fs2(con)), true);
  assert.equal(tieneUseServer(fs2(sin)), false);
});

test("TODO el repo: ningún archivo \"use server\" exporta algo que no sea una función async", () => {
  const { revisados, hallazgos } = revisar();
  assert.ok(revisados > 100, `se esperaban >100 archivos "use server", hubo ${revisados}`);
  assert.deepEqual(
    hallazgos,
    [],
    "Next 16 lanza «A \"use server\" file can only export async functions» al cargar la página:\n" +
      hallazgos.map((h) => `  ${h.archivo} · ${h.export} · ${h.motivo}`).join("\n"),
  );
});

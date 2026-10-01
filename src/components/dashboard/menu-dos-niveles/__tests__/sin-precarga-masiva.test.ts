/**
 * ws1-t12 · Abrir el panel no precarga todas las opciones del menú a la vez.
 *
 * Run: npm run test:conexiones-base
 *
 * Con el `prefetch` por defecto de <Link>, cada opción visible del menú pedía
 * su pantalla al montar el armazón; las del panel son dinámicas, así que cada
 * precarga corría el layout de /dashboard en el servidor (con sus consultas).
 * En el incidente del 1-oct-2026 abrir /dashboard disparaba ~8 de esas en el
 * mismo segundo. Se fija que los enlaces del menú (el de dos niveles y el de
 * siempre) llevan prefetch={false} y que la precarga va SOLO al detenerse
 * encima, con retraso.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Cada `<Link …>` del archivo, con sus props hasta el cierre de la etiqueta. */
function enlaces(src: string): string[] {
  const out: string[] = [];
  const re = /<Link\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + 5;
    let llaves = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") llaves++;
      else if (c === "}") llaves--;
      else if (c === ">" && llaves === 0 && src[i - 1] !== "=") break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

for (const archivo of [
  "src/components/dashboard/menu-dos-niveles/menu-dos-niveles.tsx",
  "src/components/dashboard/sidebar.tsx",
]) {
  test(`${archivo}: todo <Link> del menú va con prefetch={false}`, () => {
    const ls = enlaces(leer(archivo));
    assert.ok(ls.length > 0);
    for (const l of ls) assert.match(l, /prefetch=\{false\}/, l.slice(0, 160));
  });

  test(`${archivo}: las opciones precargan solo al detenerse encima`, () => {
    const src = leer(archivo);
    assert.match(src, /usePrecargaAlPasar\(\)/);
    const conHref = enlaces(src).filter((l) => /href=\{item\.href\}/.test(l));
    assert.ok(conHref.length > 0);
    for (const l of conHref) assert.match(l, /\{\.\.\.precargaAlPasar\(item\.href\)\}/, l.slice(0, 160));
  });
}

test("la precarga al pasar espera a que el ratón se detenga y se cancela al salir", () => {
  const src = leer("src/hooks/use-precarga-al-pasar.ts");
  assert.match(src, /^"use client";/);
  const r = /export const RETRASO_PRECARGA_MS = (\d+);/.exec(src);
  assert.ok(r && Number(r[1]) >= 100, "un paso rápido por el menú no pide nada");
  assert.match(src, /onMouseLeave: cancelar/);
  assert.match(src, /router\.prefetch\(href\)/);
});

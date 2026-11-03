/**
 * Arnés para ejecutar una PÁGINA server de /dashboard sin Next, sin base y sin
 * red (ws1-t11, leads 12 y 13 de la auditoría run-2).
 *
 * Lee los imports del page.tsx y dobla cada módulo con node:test mock.module:
 * cada export es un espía que responde con lo que la prueba fije en
 * `respuestas` («specifier#nombre»), o con un «comodín» que aguanta cualquier
 * uso (propiedad, llamada, await, iteración vacía). Prisma es un comodín que
 * anota cada `modelo.método(args)`. Los módulos de `reales` se cargan de verdad
 * (permisos, guardia clínica, claves de módulo…), que es lo que se prueba.
 *
 * Uso: preparar(...) ANTES del primer import de la página (mock.module es por
 * proceso), y luego `await import(pagina)`.
 */
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface Llamada { quien: string; args: unknown[] }

export const llamadas: Llamada[] = [];
export const respuestas = new Map<string, (...args: any[]) => unknown>();
const exportados = new Map<string, unknown>();

export class Redireccion extends Error {
  constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); }
}
export class NoEncontrado extends Error {
  constructor() { super("NEXT_NOT_FOUND"); }
}

/** Valor que aguanta todo: propiedades, llamadas, `new`, await (no es thenable) e iteración (vacía). */
export function comodin(): any {
  const cache = new Map<PropertyKey, unknown>();
  const objetivo = function () {};
  return new Proxy(objetivo, {
    get(_t, p) {
      if (p === "then" || p === "$$typeof" || p === Symbol.asyncIterator) return undefined;
      if (p === Symbol.iterator) return function* () {};
      if (p === Symbol.toPrimitive) return (hint: string) => (hint === "number" ? 0 : "");
      if (p === "length") return 0;
      if (p === "toString" || p === "valueOf") return () => "";
      if (p === "toJSON") return () => null;
      if (!cache.has(p)) cache.set(p, comodin());
      return cache.get(p);
    },
    apply() { return comodin(); },
    construct() { return comodin(); },
  });
}

/** Prisma de mentira: cada `prisma.<modelo>.<método>(args)` se anota; responde con `respuestas.get("prisma.<modelo>.<método>")`. */
export function prismaFalso(): any {
  return new Proxy({}, {
    get(_t, modelo) {
      if (modelo === "then") return undefined;
      if (modelo === "$transaction") {
        return async (x: unknown) => (typeof x === "function" ? (x as (p: unknown) => unknown)(prismaFalso()) : Promise.all(x as unknown[]));
      }
      return new Proxy({}, {
        get(_t2, metodo) {
          if (metodo === "then") return undefined;
          const quien = `prisma.${String(modelo)}.${String(metodo)}`;
          return (...args: unknown[]) => {
            llamadas.push({ quien, args });
            const r = respuestas.get(quien);
            return Promise.resolve(r ? r(...args) : String(metodo).startsWith("findMany") || metodo === "groupBy" ? [] : null);
          };
        },
      });
    },
  });
}

interface Importacion { especificador: string; nombres: Set<string>; conDefault: boolean }

function importsDe(archivo: string): Importacion[] {
  const src = readFileSync(archivo, "utf8");
  const out = new Map<string, Importacion>();
  const re = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;
  for (const m of src.matchAll(re)) {
    if (m[1]) continue; // import type
    const clausula = m[2];
    const spec = m[3];
    const imp = out.get(spec) ?? { especificador: spec, nombres: new Set<string>(), conDefault: false };
    const llaves = clausula.match(/\{([\s\S]*)\}/);
    if (llaves) {
      for (const parte of llaves[1].split(",")) {
        const p = parte.trim();
        if (!p || p.startsWith("type ")) continue;
        imp.nombres.add(p.split(/\s+as\s+/)[0].trim());
      }
    }
    const antes = clausula.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
    if (antes && !antes.startsWith("*")) imp.conDefault = true;
    out.set(spec, imp);
  }
  return [...out.values()];
}

/** El valor exportado que la página recibió por `spec#nombre` (para comparar tipos de elementos JSX). */
export function exportado(spec: string, nombre: string): unknown {
  return exportados.get(`${spec}#${nombre}`);
}

function espia(clave: string): unknown {
  const f = (...args: unknown[]) => {
    llamadas.push({ quien: clave, args });
    const r = respuestas.get(clave);
    return r ? r(...args) : comodin();
  };
  exportados.set(clave, f);
  return f;
}

/**
 * Dobla todos los imports de `paginas` (rutas relativas a la raíz del repo)
 * salvo los de `reales`. `fijos` sustituye un módulo entero (namedExports).
 */
export function preparar(opciones: {
  paginas: string[];
  reales: string[];
  fijos?: Record<string, Record<string, unknown>>;
}) {
  const raiz = process.cwd();
  const porSpec = new Map<string, { url: string; nombres: Set<string>; conDefault: boolean; specs: string[] }>();
  for (const pagina of opciones.paginas) {
    const abs = resolve(raiz, pagina);
    for (const imp of importsDe(abs)) {
      if (opciones.reales.includes(imp.especificador)) continue;
      // También por ruta de archivo («src/...»): dos «./_helpers» de carpetas distintas no son el mismo.
      if (imp.especificador.startsWith(".")) {
        const rel = resolve(dirname(abs), imp.especificador).slice(raiz.length + 1);
        if (opciones.reales.some((r) => r.startsWith("src/") && (r === rel || r === rel + ".ts" || r === rel + ".tsx"))) continue;
      }
      let url = imp.especificador;
      // «./x», «../x» y «@/lib/x» pueden ser el MISMO archivo: se agrupan por su ruta real.
      if (url.startsWith(".") || url.startsWith("@/")) {
        const base = url.startsWith("@/") ? resolve(raiz, "src", url.slice(2)) : resolve(dirname(abs), url);
        const conExt = [".tsx", ".ts", "/index.tsx", "/index.ts"].map((e) => base + e).find((c) => {
          try { readFileSync(c); return true; } catch { return false; }
        });
        url = pathToFileURL(conExt ?? base).href;
      }
      // Un mismo archivo puede llegar por dos especificadores («./x» y «../x»):
      // un solo doble, registrado bajo todos sus nombres.
      const prev = porSpec.get(url) ?? { url, nombres: new Set<string>(), conDefault: false, specs: [] as string[] };
      imp.nombres.forEach((n) => prev.nombres.add(n));
      prev.conDefault ||= imp.conDefault;
      if (!prev.specs.includes(imp.especificador)) prev.specs.push(imp.especificador);
      porSpec.set(url, prev);
    }
  }
  for (const [url, info] of porSpec) {
    const [spec, ...alias] = info.specs;
    const registrarAlias = () => {
      for (const n of [...info.nombres, "default"]) {
        if (exportados.has(`${spec}#${n}`)) for (const a of alias) exportados.set(`${a}#${n}`, exportados.get(`${spec}#${n}`));
      }
    };
    if (opciones.fijos?.[spec]) {
      for (const [n, v] of Object.entries(opciones.fijos[spec])) exportados.set(`${spec}#${n}`, v);
      mock.module(url, { namedExports: opciones.fijos[spec] });
      registrarAlias();
      continue;
    }
    const namedExports: Record<string, unknown> = {};
    for (const n of info.nombres) namedExports[n] = espia(`${spec}#${n}`);
    mock.module(url, info.conDefault ? { namedExports, defaultExport: espia(`${spec}#default`) } : { namedExports });
    registrarAlias();
  }
}

/** Recorre un árbol de elementos de React y devuelve los props de cada elemento del tipo `tipo`. */
export function propsDe(arbol: unknown, tipo: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visitar = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(visitar); return; }
    if (!n || typeof n !== "object" || !("props" in (n as object))) return;
    const el = n as { type: unknown; props: Record<string, unknown> };
    if (el.type === tipo) out.push(el.props);
    visitar(el.props.children);
  };
  visitar(arbol);
  return out;
}

export function llamo(quien: string): boolean {
  return llamadas.some((l) => l.quien === quien);
}

// ── un `where` de Prisma evaluado sobre una fila (lo que usan estas páginas) ──
export function cumple(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "AND") return (Array.isArray(v) ? v : [v]).every((w) => cumple(fila, w));
    if (k === "OR") return (v as any[]).some((w) => cumple(fila, w));
    if (k === "NOT") return !(Array.isArray(v) ? v : [v]).some((w) => cumple(fila, w));
    const x = fila?.[k];
    if (v === null || typeof v !== "object" || v instanceof Date) return x === v || (v === null && x === undefined);
    if ("is" in v) return x != null && cumple(x, v.is);
    if ("notIn" in v || "in" in v || "has" in v || "isEmpty" in v || "equals" in v) {
      if ("notIn" in v && (x == null || v.notIn.includes(x))) return false;
      if ("in" in v && !v.in.includes(x)) return false;
      if ("has" in v && !(Array.isArray(x) && x.includes(v.has))) return false;
      if ("isEmpty" in v && (Array.isArray(x) ? x.length === 0 : false) !== v.isEmpty) return false;
      if ("equals" in v && x !== v.equals) return false;
      return true;
    }
    return cumple(x, v); // relación anidada sin operador
  });
}

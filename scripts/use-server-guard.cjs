#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Guardia de los archivos "use server" (ws1-t5, Next 16).
//
// Un archivo con la directiva "use server" a nivel de archivo solo puede
// exportar FUNCIONES ASYNC. Next 16 lo comprueba al ejecutar: si un export es un
// objeto/constante/enum/función síncrona/clase, o un `export * from` / `export {x}
// from` que arrastra uno, la página que lo importe lanza
//   «A "use server" file can only export async functions, found object»
// (digest invalid-use-server-value) y la pantalla cae. TypeScript no lo avisa.
//
// Uso:  node scripts/use-server-guard.cjs [--json]      → exit 1 si hay hallazgos
// Es lo que corre `npm run test:use-server` (scripts/use-server-guard.test.cjs).
//
// Reglas (los tipos/interfaces NO cuentan: se borran en la compilación):
//   OK    export async function f() {} · export const f = async () => {} ·
//         export const f = async function () {} · export { f } de una async ·
//         export { f } from "./x" / export * from "./x" cuando TODO lo que llega
//         es async function · export default async function
//   MAL   export function f() {} (síncrona) · export const X = 1 / {} / [] / fn
//         síncrona / cualquier otra expresión · export enum · export class ·
//         export default <no async> · re-exports que arrastran algo de lo anterior
// ════════════════════════════════════════════════════════════════════════════
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const RAIZ = path.join(__dirname, "..");
const SRC = path.join(RAIZ, "src");

function listar(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (n === "node_modules" || n === ".next") continue;
      listar(p, out);
    } else if (/\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
  }
  return out;
}

const cacheFuentes = new Map();
function parsear(archivo) {
  if (!cacheFuentes.has(archivo)) {
    const texto = fs.readFileSync(archivo, "utf8");
    cacheFuentes.set(archivo, ts.createSourceFile(archivo, texto, ts.ScriptTarget.ES2022, true, archivo.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  }
  return cacheFuentes.get(archivo);
}

/** ¿Tiene la directiva "use server" a nivel de archivo (antes de cualquier otra sentencia)? */
function tieneUseServer(sf) {
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) {
      if (st.expression.text === "use server") return true;
      continue;
    }
    break;
  }
  return false;
}

function resolverModulo(desde, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(desde), spec);
  else return null; // paquete externo
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

const tieneMod = (n, k) => !!n.modifiers && n.modifiers.some((m) => m.kind === k);
const esAsyncFn = (e) => e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) && tieneMod(e, ts.SyntaxKind.AsyncKeyword);
function desenvolver(e) {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isNonNullExpression(e))) e = e.expression;
  return e;
}

/**
 * Los exports de VALOR de un módulo: Map<nombre, "async" | "mal:<motivo>" | "dudoso:<motivo>">.
 * `visitando` corta ciclos.
 */
function exportsDe(archivo, visitando = new Set()) {
  const res = new Map();
  if (visitando.has(archivo)) return res;
  visitando.add(archivo);
  const sf = parsear(archivo);
  const locales = new Map(); // nombre local → clasificación
  const reexportes = [];

  const clasificarVar = (decl) => {
    const init = desenvolver(decl.initializer);
    if (esAsyncFn(init)) return "async";
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return "mal:función no async";
    if (init && ts.isIdentifier(init)) return null; // alias; se resuelve abajo
    if (init && ts.isCallExpression(init)) return "dudoso:resultado de una llamada (¿es una función async?)";
    if (init && ts.isAwaitExpression(init)) return "dudoso:resultado de un await";
    return "mal:valor que no es una función async";
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      const exp = tieneMod(st, ts.SyntaxKind.ExportKeyword);
      const def = tieneMod(st, ts.SyntaxKind.DefaultKeyword);
      const k = tieneMod(st, ts.SyntaxKind.AsyncKeyword) ? "async" : "mal:función no async";
      locales.set(st.name.text, k);
      if (exp) res.set(def ? "default" : st.name.text, k);
    } else if (ts.isFunctionDeclaration(st) && !st.name && tieneMod(st, ts.SyntaxKind.ExportKeyword) && tieneMod(st, ts.SyntaxKind.DefaultKeyword)) {
      res.set("default", tieneMod(st, ts.SyntaxKind.AsyncKeyword) ? "async" : "mal:default función no async");
    } else if (ts.isVariableStatement(st)) {
      const exp = tieneMod(st, ts.SyntaxKind.ExportKeyword);
      const esConstEnum = false;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) {
          if (exp) for (const el of d.name.elements ?? []) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) res.set(el.name.text, "mal:desestructuración");
          continue;
        }
        const k = clasificarVar(d);
        locales.set(d.name.text, k ?? { alias: desenvolver(d.initializer).text });
        if (exp) res.set(d.name.text, k ?? { alias: desenvolver(d.initializer).text });
      }
      void esConstEnum;
    } else if (ts.isClassDeclaration(st) && st.name) {
      locales.set(st.name.text, "mal:clase");
      if (tieneMod(st, ts.SyntaxKind.ExportKeyword)) res.set(tieneMod(st, ts.SyntaxKind.DefaultKeyword) ? "default" : st.name.text, "mal:clase");
    } else if (ts.isEnumDeclaration(st)) {
      const k = tieneMod(st, ts.SyntaxKind.ConstKeyword) ? null : "mal:enum (objeto en runtime)";
      if (k) {
        locales.set(st.name.text, k);
        if (tieneMod(st, ts.SyntaxKind.ExportKeyword)) res.set(st.name.text, k);
      }
    } else if (ts.isExportAssignment(st)) {
      const e = desenvolver(st.expression);
      if (st.isExportEquals) res.set("export=", "mal:export =");
      else if (esAsyncFn(e)) res.set("default", "async");
      else if (ts.isIdentifier(e)) res.set("default", { alias: e.text });
      else res.set("default", "mal:default no es una función async");
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      const spec = st.moduleSpecifier && st.moduleSpecifier.text;
      if (!st.exportClause) {
        if (spec) reexportes.push({ todo: true, spec });
      } else if (ts.isNamespaceExport(st.exportClause)) {
        res.set(st.exportClause.name.text, "mal:export * as ns (objeto)");
      } else {
        for (const el of st.exportClause.elements) {
          if (el.isTypeOnly) continue;
          const local = (el.propertyName ?? el.name).text;
          if (spec) reexportes.push({ nombre: el.name.text, origen: local, spec });
          else res.set(el.name.text, { alias: local });
        }
      }
    }
  }

  const resolver = (v, prof = 0) => {
    if (typeof v === "string" || v == null) return v;
    if (prof > 10) return "dudoso:alias circular";
    if (v.alias) {
      if (!locales.has(v.alias)) {
        // importado de otro módulo o tipo: si es un import, se trata como dudoso; un tipo no llega aquí
        return "dudoso:alias de algo importado (" + v.alias + ")";
      }
      return resolver(locales.get(v.alias), prof + 1);
    }
    return v;
  };
  for (const [k, v] of [...res]) res.set(k, resolver(v));

  for (const r of reexportes) {
    const mod = resolverModulo(archivo, r.spec);
    if (!mod) { // paquete externo
      if (r.todo) res.set(`*(${r.spec})`, "dudoso:export * de un paquete externo");
      else res.set(r.nombre, "dudoso:re-export de un paquete externo");
      continue;
    }
    const ajeno = exportsDe(mod, visitando);
    if (r.todo) { for (const [k, v] of ajeno) if (k !== "default" && !res.has(k)) res.set(k, v); }
    else if (ajeno.has(r.origen)) res.set(r.nombre, ajeno.get(r.origen));
    // si no está en `ajeno`, era un tipo: no cuenta
  }
  return res;
}

function revisar() {
  const hallazgos = [];
  let revisados = 0;
  for (const f of listar(SRC)) {
    const txt = fs.readFileSync(f, "utf8");
    if (!/["']use server["']/.test(txt)) continue;
    const sf = parsear(f);
    if (!tieneUseServer(sf)) continue;
    revisados++;
    for (const [nombre, k] of exportsDe(f)) {
      if (k === "async") continue;
      const dudoso = typeof k === "string" && k.startsWith("dudoso:");
      hallazgos.push({
        archivo: path.relative(RAIZ, f).split(path.sep).join("/"),
        export: nombre,
        nivel: dudoso ? "dudoso" : "mal",
        motivo: typeof k === "string" ? k.replace(/^(mal|dudoso):/, "") : "desconocido",
      });
    }
  }
  return { revisados, hallazgos };
}

module.exports = { revisar, exportsDe, tieneUseServer };

if (require.main === module) {
  const { revisados, hallazgos } = revisar();
  if (process.argv.includes("--json")) console.log(JSON.stringify({ revisados, hallazgos }, null, 1));
  else {
    console.log(`[use-server-guard] ${revisados} archivos "use server" revisados, ${hallazgos.length} hallazgos`);
    for (const h of hallazgos) console.log(`  ${h.nivel.toUpperCase().padEnd(6)} ${h.archivo} · ${h.export} · ${h.motivo}`);
  }
  process.exit(hallazgos.length ? 1 : 0);
}

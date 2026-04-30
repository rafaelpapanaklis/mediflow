import "server-only";
import {
  walkFiles,
  readFileText,
  relPath,
  lineAt,
  lineOf,
  makeItem,
  safeSnippet,
} from "../helpers";
import type { BugItem } from "../types";

/**
 * 3.1 N+1 — `for (...) { await prisma.X.find* }` o map/forEach con
 * await prisma adentro. HIGH si está en src/app/api o src/app/dashboard.
 */
export async function scanNPlusOne(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    if (!rel.startsWith("src/app/api/") && !rel.startsWith("src/app/dashboard/")) continue;
    const txt = await readFileText(f);
    // Patrón 1: for (...) { ... await prisma.X.findX/count/aggregate ... }
    const re = /for\s*\([^)]*\)\s*\{[\s\S]{1,500}?await\s+prisma\.\w+\.(findFirst|findUnique|findMany|count|aggregate)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const ln = lineAt(txt, m.index);
      items.push(
        makeItem({
          category: "n-plus-one",
          severity: "high",
          file: rel,
          line: ln,
          title: "Posible N+1: prisma.find dentro de un for",
          description:
            "Un loop con queries Prisma adentro escala lineal con N. Para N=20 son 20 round-trips serie a la DB. En endpoints calientes degrada P95 brutalmente.",
          suggestion:
            "Reemplazá por un solo query con `where: { id: { in: ids } }` + `groupBy` + map en JS. Para counts agregados usá `prisma.X.groupBy({ by: [...], _count: { _all: true } })`.",
          code_snippet: safeSnippet(lineOf(txt, ln)),
        }),
      );
    }
    // Patrón 2: arr.map(async (...) => { await prisma.X.find }).
    const re2 = /\.map\s*\(\s*async[^)]*\)\s*=>\s*\{[\s\S]{1,300}?await\s+prisma\.\w+\.(findFirst|findUnique|findMany)/g;
    while ((m = re2.exec(txt)) !== null) {
      const ln = lineAt(txt, m.index);
      items.push(
        makeItem({
          category: "n-plus-one",
          severity: "high",
          file: rel,
          line: ln,
          title: "Posible N+1: prisma.find dentro de un map async",
          description:
            "arr.map(async ... await prisma.find ...) lanza N round-trips en paralelo (mejor que serie pero peor que un solo query con `in`).",
          suggestion:
            "Reemplazá por `prisma.X.findMany({ where: { id: { in: ids } } })` y reorganizá el resultado con un Map<id, X>.",
          code_snippet: safeSnippet(lineOf(txt, ln)),
        }),
      );
    }
  }
  return items;
}

/**
 * 3.2 findMany sin select explícito — sobre-fetch de columnas.
 */
export async function scanNoSelect(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    if (!rel.startsWith("src/app/api/") && !rel.startsWith("src/lib/")) continue;
    const txt = await readFileText(f);
    // Match prisma.X.findMany( {...} ) sin "select:" en los primeros
    // 800 chars del bloque {} (heurística).
    const re = /prisma\.(\w+)\.findMany\s*\(\s*\{([\s\S]{0,800}?)\}\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const body = m[2];
      if (/select\s*:/.test(body)) continue;
      const ln = lineAt(txt, m.index);
      items.push(
        makeItem({
          category: "no-select",
          severity: "medium",
          file: rel,
          line: ln,
          title: `findMany sin select en prisma.${m[1]}.findMany`,
          description:
            "findMany sin select trae todas las columnas declaradas en el schema, incluso JSON pesados (vitals, specialtyData, annotations, findings) que no se usan en la UI.",
          suggestion:
            "Agregá `select: { id: true, ... }` o `include: { ... }` con solo los campos que el cliente consume. Reduce payload + tiempo de query + memoria.",
          code_snippet: safeSnippet(lineOf(txt, ln)),
        }),
      );
    }
  }
  return items;
}

/**
 * 3.7 Componentes pesados sin dynamic import.
 * Heurística: archivos que importan recharts / @react-pdf / signature-canvas /
 * react-quill / react-dnd directamente en client components grandes.
 */
const HEAVY_LIBS = [
  "recharts",
  "@react-pdf/renderer",
  "react-signature-canvas",
  "react-quill",
  "react-dnd",
  "react-pdf",
  "@daily-co/daily-js",
];

export async function scanHeavyImports(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src", [".tsx", ".jsx", ".ts"]);
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    if (!/^"use client"/m.test(txt)) continue;
    if (rel.includes("/lib/pdf/")) continue; // PDF se usa en API server (renderToBuffer) — esos files no son client.
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      // Solo importaciones estáticas (no dynamic()).
      const m = /^import\s+[^"'`]*from\s+["']([^"']+)["']/.exec(line.trim());
      if (!m) return;
      const mod = m[1];
      if (HEAVY_LIBS.some((lib) => mod === lib || mod.startsWith(lib + "/"))) {
        items.push(
          makeItem({
            category: "dynamic-imports",
            severity: "medium",
            file: rel,
            line: i + 1,
            title: `Import estático de librería pesada: ${mod}`,
            description:
              `${mod} agrega 50–200kb min+gz al bundle inicial. En client components que no son críticos para el primer paint, conviene cargarla bajo demanda.`,
            suggestion:
              `Convertí el import a \`const Comp = dynamic(() => import("${mod}").then(m => m.X), { ssr: false, loading: () => <Skeleton /> })\` para sacarla del bundle inicial.`,
            code_snippet: safeSnippet(line),
          }),
        );
      }
    });
  }
  return items;
}

/**
 * 3.9 useEffect sin cleanup ni AbortController — leaks típicos.
 */
export async function scanUseEffectLeaks(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src", [".tsx", ".jsx"]);
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    if (!/useEffect/.test(txt)) continue;
    // Match useEffect bodies (heurística: hasta 1500 chars con balanceo simple).
    const re = /useEffect\(\s*\(\s*\)\s*=>\s*\{([\s\S]{0,1500}?)\}\s*,\s*\[/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const body = m[1];
      const hasFetch = /\bfetch\(/.test(body);
      const hasInterval = /setInterval|setTimeout/.test(body);
      const hasListener = /addEventListener\b/.test(body);
      const hasAbort = /AbortController|controller\.abort|signal:\s*ctrl/.test(body);
      const hasReturn = /\breturn\s+\(\s*\)\s*=>|return\s+function|return\s+\(\s*\(\s*\)/.test(body);
      const ln = lineAt(txt, m.index);
      if (hasFetch && !hasAbort) {
        items.push(
          makeItem({
            category: "useeffect-leak",
            severity: "low",
            file: rel,
            line: ln,
            title: "useEffect con fetch sin AbortController",
            description:
              "Si el componente se desmonta antes de que el fetch resuelva, hay race condition: el setState puede llegar después del unmount o stale data sobreescribir data nueva.",
            suggestion:
              "Crea `const ctrl = new AbortController()` antes del fetch, pasalo en `signal: ctrl.signal`, y devolvé `() => ctrl.abort()` desde el useEffect.",
            code_snippet: safeSnippet(lineOf(txt, ln)),
          }),
        );
      }
      if ((hasInterval || hasListener) && !hasReturn) {
        items.push(
          makeItem({
            category: "useeffect-leak",
            severity: "medium",
            file: rel,
            line: ln,
            title: "useEffect con timer/listener sin cleanup",
            description:
              "setInterval / setTimeout / addEventListener sin función de cleanup que devuelva un return en el useEffect dejan callbacks colgados — potencial memory leak y ejecución sobre componentes desmontados.",
            suggestion:
              "Devolvé `() => { clearInterval(id); el.removeEventListener(...); }` desde el useEffect.",
            code_snippet: safeSnippet(lineOf(txt, ln)),
          }),
        );
      }
    }
  }
  return items;
}

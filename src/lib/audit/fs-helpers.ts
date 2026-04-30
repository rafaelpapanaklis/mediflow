/**
 * Helpers de filesystem para los scanners. Walk recursivo, read seguro,
 * detección de "use client", grep sobre líneas.
 *
 * Los scanners corren en el server (Node runtime). Limitamos profundidad y
 * tamaño de archivos para no colgar el endpoint si alguien sube binarios al
 * repo accidentalmente.
 */

import fs from "node:fs/promises";
import path from "node:path";

// Re-exportamos safeSnippet desde types para que los scanners solo importen
// de un sitio (`../fs-helpers`) y no necesiten conocer dónde vive cada util.
export { safeSnippet } from "./types";

const MAX_FILE_BYTES = 1_000_000; // 1 MB
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build",
  "coverage", ".turbo", ".vercel", ".cache",
]);

export interface SourceFile {
  /** Path absoluto. */
  abs: string;
  /** Path relativo a la raíz del repo (con / siempre). */
  rel: string;
  /** Contenido completo (max 1 MB; si excede, queda truncado). */
  content: string;
  /** Líneas separadas. Útil para reportar `line`. */
  lines: string[];
}

/** Raíz del repo: dos niveles arriba de src/lib/audit. */
export function repoRoot(): string {
  return process.cwd();
}

/**
 * Camina recursivamente desde `dirAbs` y devuelve los archivos que matchean
 * la extensión. Skipea node_modules, .next, etc.
 */
export async function walk(dirAbs: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  async function visit(d: string) {
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await visit(full);
      else if (exts.some(x => e.name.endsWith(x))) out.push(full);
    }
  }
  await visit(dirAbs);
  return out;
}

export async function readFileSafe(abs: string): Promise<SourceFile | null> {
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) return null;
    const content = await fs.readFile(abs, "utf-8");
    const rel = path.relative(repoRoot(), abs).replace(/\\/g, "/");
    return { abs, rel, content, lines: content.split("\n") };
  } catch {
    return null;
  }
}

export async function readManyAbs(absPaths: string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const a of absPaths) {
    const f = await readFileSafe(a);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Resuelve glob simple: `src/app/api/**\/route.ts`. Solo soporta `**` y nombre
 * fijo de archivo, suficiente para nuestros patrones.
 */
export async function resolveGlob(pattern: string): Promise<string[]> {
  // Detectar patrón "<dir>/**/<filename>"
  const m = pattern.match(/^(.+?)\/\*\*\/(.+)$/);
  if (m) {
    const baseDir = path.join(repoRoot(), m[1]);
    const target = m[2];
    const exts = target.startsWith("*.") ? [target.slice(1)] : [];
    const all = exts.length > 0 ? await walk(baseDir, exts) : await walk(baseDir, [".ts", ".tsx", ".js", ".jsx"]);
    return target.startsWith("*.") ? all : all.filter(p => p.endsWith("/" + target));
  }
  // Solo extensión por raíz
  const m2 = pattern.match(/^(.+?)\/\*\.(.+)$/);
  if (m2) {
    const baseDir = path.join(repoRoot(), m2[1]);
    return walk(baseDir, ["." + m2[2]]);
  }
  // Path literal
  const single = path.join(repoRoot(), pattern);
  try {
    await fs.access(single);
    return [single];
  } catch {
    return [];
  }
}

export function isUseClient(content: string): boolean {
  // Match "use client" en primeras 5 líneas, con cualquier comilla y comentarios opcionales antes.
  const head = content.split("\n").slice(0, 5).join("\n");
  return /^\s*['"]use client['"]/m.test(head);
}

/**
 * Devuelve `[lineIndex0Based, line]` para cada match del regex en el contenido.
 * Útil para reportar línea junto a snippet.
 */
export function findLineMatches(content: string, regex: RegExp): { line: number; text: string }[] {
  const lines = content.split("\n");
  const out: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) out.push({ line: i + 1, text: lines[i] });
    // reset lastIndex en regex global para que no salte líneas
    if (regex.global) regex.lastIndex = 0;
  }
  return out;
}

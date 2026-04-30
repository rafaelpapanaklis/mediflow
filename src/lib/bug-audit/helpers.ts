import "server-only";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { BugItem, BugCategory, BugSeverity, BugSummary } from "./types";

const ROOT = process.cwd();

/** Raíz del repo. Alias para legibilidad en scanners que ya importan repoRoot. */
export function repoRoot(): string {
  return ROOT;
}

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build",
  "coverage", ".turbo", ".vercel", ".cache",
]);
/** Tamaño máximo (bytes) de archivo que el scanner leerá. */
const MAX_FILE_BYTES = 1_000_000;

/** Archivo cargado en memoria, listo para scannear. */
export interface SourceFile {
  /** Path absoluto. */
  abs: string;
  /** Path relativo al repo root, con `/` siempre. */
  rel: string;
  /** Contenido completo (truncado si excede MAX_FILE_BYTES). */
  content: string;
  /** Líneas separadas por `\n` — útil para reportar `line`. */
  lines: string[];
}

/**
 * Walk recursivo desde `dirAbs` que devuelve paths absolutos de archivos
 * que matchean alguna de las extensiones. Skipea node_modules/.next/etc.
 * Devuelve absolutos para componer con `readFileSafe`.
 */
export async function walk(dirAbs: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  async function visit(d: string) {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await visit(full);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
    }
  }
  await visit(dirAbs);
  return out;
}

/** Lee un archivo, tolera fallos y aplica límite de tamaño. */
export async function readFileSafe(abs: string): Promise<SourceFile | null> {
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) return null;
    const content = await fs.readFile(abs, "utf-8");
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    return { abs, rel, content, lines: content.split("\n") };
  } catch {
    return null;
  }
}

/** Lee múltiples paths absolutos secuencialmente, descarta los que fallan. */
export async function readManyAbs(absPaths: string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const a of absPaths) {
    const f = await readFileSafe(a);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Resuelve glob simple: `<dir>/**\/<filename>` o `<dir>/**\/*.ext`.
 * Suficiente para los patrones del scanner; no soporta sintaxis avanzada.
 */
export async function resolveGlob(pattern: string): Promise<string[]> {
  const m = pattern.match(/^(.+?)\/\*\*\/(.+)$/);
  if (m) {
    const baseDir = path.join(ROOT, m[1]);
    const target = m[2];
    const exts = target.startsWith("*.") ? [target.slice(1)] : [];
    const all = exts.length > 0
      ? await walk(baseDir, exts)
      : await walk(baseDir, [".ts", ".tsx", ".js", ".jsx"]);
    return target.startsWith("*.") ? all : all.filter((p) => p.endsWith("/" + target));
  }
  const m2 = pattern.match(/^(.+?)\/\*\.(.+)$/);
  if (m2) {
    const baseDir = path.join(ROOT, m2[1]);
    return walk(baseDir, ["." + m2[2]]);
  }
  const single = path.join(ROOT, pattern);
  try {
    await fs.access(single);
    return [single];
  } catch {
    return [];
  }
}

/** True si el archivo declara `"use client"` en sus primeras 5 líneas. */
export function isUseClient(content: string): boolean {
  const head = content.split("\n").slice(0, 5).join("\n");
  return /^\s*['"]use client['"]/m.test(head);
}

/** Devuelve `{line, text}` para cada línea que matchea el regex. */
export function findLineMatches(content: string, regex: RegExp): { line: number; text: string }[] {
  const lines = content.split("\n");
  const out: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) out.push({ line: i + 1, text: lines[i] });
    if (regex.global) regex.lastIndex = 0;
  }
  return out;
}

/**
 * Pesos por severidad para el health score. Mayor severidad = mayor peso.
 * Score = max(0, 100 - sum(items[s].count * weight[s])).
 */
const SEVERITY_WEIGHT: Record<BugSeverity, number> = {
  critical: 5,
  high: 2,
  medium: 0.5,
  low: 0.1,
};

export function summarize(items: BugItem[]): BugSummary {
  const bySeverity: Record<BugSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory: Partial<Record<BugCategory, number>> = {};
  for (const it of items) {
    bySeverity[it.severity] += 1;
    byCategory[it.category] = (byCategory[it.category] ?? 0) + 1;
  }
  let penalty = 0;
  (Object.keys(bySeverity) as BugSeverity[]).forEach((s) => {
    penalty += bySeverity[s] * SEVERITY_WEIGHT[s];
  });
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { total: items.length, bySeverity, byCategory, healthScore };
}

export function fingerprintOf(it: Omit<BugItem, "fingerprint">): string {
  const key = `${it.category}|${it.file}|${it.line ?? "?"}|${it.title}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function makeItem(it: Omit<BugItem, "fingerprint">): BugItem {
  return { ...it, fingerprint: fingerprintOf(it) };
}

/**
 * Trunca y enmascara snippets antes de exponer en UI. Reemplaza tokens
 * que parezcan secrets (Stripe sk_/pk_, JWT eyJ, AWS access keys, claves
 * largas, valores tras SUPABASE_SERVICE_ROLE_KEY=) por máscaras seguras.
 *
 * `maxLen` por default 240 chars (suficiente para una línea de código);
 * los scanners pueden pedir 200 si quieren snippets más cortos.
 */
export function safeSnippet(raw: string | null, maxLen = 240): string | null {
  if (!raw) return null;
  let s = raw.length > maxLen ? raw.slice(0, maxLen) + "…" : raw;
  s = s.replace(/(sk_(live|test)_[A-Za-z0-9]{12,})/g, (m) => `${m.slice(0, 8)}…[REDACTED]`);
  s = s.replace(/(pk_(live|test)_[A-Za-z0-9]{12,})/g, (m) => `${m.slice(0, 8)}…[REDACTED]`);
  s = s.replace(/(eyJ[A-Za-z0-9_-]{20,})/g, (m) => `${m.slice(0, 8)}…[JWT]`);
  s = s.replace(/(AKIA[0-9A-Z]{16})/g, "[AWS_KEY]");
  s = s.replace(/SUPABASE_SERVICE_ROLE_KEY[^\n]{0,200}/g, "SUPABASE_SERVICE_ROLE_KEY=[REDACTED]");
  s = s.replace(/([A-Za-z0-9]{32,})/g, (m) => (m.length > 32 ? `${m.slice(0, 8)}…[KEY]` : m));
  return s;
}

/**
 * Walk recursivo de un directorio. Skip node_modules, .next, .git, etc.
 * Filtra por extensiones permitidas.
 */
export async function walkFiles(
  rel: string,
  exts: string[] = [".ts", ".tsx", ".js", ".jsx"],
): Promise<string[]> {
  const abs = path.join(ROOT, rel);
  const out: string[] = [];
  async function visit(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await visit(p);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  }
  await visit(abs);
  return out;
}

export async function readFileText(absPath: string): Promise<string> {
  return fs.readFile(absPath, "utf8");
}

/** Devuelve la ruta relativa al ROOT (con / como separador) — para mostrar en UI. */
export function relPath(absPath: string): string {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

/** Encuentra la línea de un offset en el texto. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Devuelve el snippet (1 línea) en `line`, sin saltos. */
export function lineOf(text: string, line: number): string {
  const lines = text.split("\n");
  return (lines[line - 1] ?? "").trim().slice(0, 200);
}

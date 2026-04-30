import "server-only";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { BugItem, BugCategory, BugSeverity, BugSummary } from "./types";

const ROOT = process.cwd();

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
 * que parezcan secrets (sk_live_, eyJ JWT, claves >24 chars) por su
 * primer 8 + "…".
 */
export function safeSnippet(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
  s = s.replace(/(sk_(live|test)_[A-Za-z0-9]{12,})/g, (m) => `${m.slice(0, 8)}…[REDACTED]`);
  s = s.replace(/(eyJ[A-Za-z0-9_-]{20,})/g, (m) => `${m.slice(0, 8)}…[JWT]`);
  s = s.replace(/(AKIA[0-9A-Z]{16})/g, "[AWS_KEY]");
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

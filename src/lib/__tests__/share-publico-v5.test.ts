/**
 * Seguridad, ola 2 · hueco residual del lead 11 (opción a): la página PÚBLICA `/share/p/[token]` (sin
 * sesión, fuera del middleware) importaba `resolvePublicShareToken` desde el módulo "use server" de
 * `@/app/actions/clinical-shared/share-links`. En Next eso registra en esa página TODAS las server actions
 * del archivo (crear, revocar y listar links): una action mandada a la página pública llegaba a ellas.
 * Ahora la vista pública vive en `@/lib/clinical-shared/share/resolve-public-token`, un módulo normal.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 *   · estructural — desde page.tsx, ningún módulo alcanzable (imports estáticos, dinámicos y reexports,
 *     resolviendo `@/` y rutas relativas) lleva "use server";
 *   · comportamiento — la vista pública resuelve igual (válido, revocado, caducado, inexistente), la
 *     página sigue pintando el link, y share-links conserva sus tres acciones legítimas.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

const raiz = path.resolve(__dirname, "../../..");
const PAGINA = path.join(raiz, "src/app/share/p/[token]/page.tsx");

function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(raiz, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(desde), spec);
  else return null; // paquete de node_modules
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Módulos del repo alcanzables desde `inicio` (sin `import type`, que se borra al compilar). */
function grafo(inicio: string): string[] {
  const vistos = new Set<string>();
  const pila = [inicio];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  while (pila.length) {
    const f = pila.pop()!;
    if (vistos.has(f)) continue;
    vistos.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) {
      const r = resolver(f, m[1] ?? m[2] ?? m[3]);
      if (r && /\.(ts|tsx)$/.test(r)) pila.push(r);
    }
  }
  return [...vistos];
}

test("/share/p/[token] no alcanza ningún módulo \"use server\" (no expone server actions)", () => {
  const modulos = grafo(PAGINA);
  assert.ok(modulos.length > 3, `el grafo dejó de seguir los imports (${modulos.length})`);
  const conAcciones = modulos
    .filter((f) => /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use server["']/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(raiz, f));
  assert.deepEqual(conAcciones, [], "la página pública registra las server actions de estos módulos");
});

// ── Comportamiento ──────────────────────────────────────────────────────────────────────────────────

let links: Record<string, any> = {};
const prisma: any = {
  patientShareLink: {
    findUnique: async (a: any) => {
      const l = links[a.where.token];
      if (!l) return null;
      return a.select?.module && Object.keys(a.select).length === 1 ? { module: l.module } : l;
    },
    update: async () => ({}),
  },
  patient: { findUnique: async () => ({ firstName: "Ana", deletedAt: null }) },
  clinic: { findUnique: async () => ({ name: "Clínica A" }) },
  sealant: { count: async () => 2 },
  fluorideApplication: { count: async () => 1 },
  behaviorAssessment: { count: async () => 3, findFirst: async () => ({ scale: "frankl", value: 4 }) },
  pediatricConsent: { count: async () => 1 },
  cariesRiskAssessment: { findFirst: async () => null },
  oralHabit: { count: async () => 0 },
};
const doblesPorArchivo: Record<string, unknown> = {
  [path.join(raiz, "src/app/share/p/[token]/ImplantShareTimeline.tsx")]: { default: () => null },
  [path.join(raiz, "src/app/share/p/[token]/PerioShareView.tsx")]: { PerioShareView: () => null },
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/navigation": { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } },
  "@/lib/prisma": { prisma },
  "@/components/share/OrthoSharePage": { OrthoSharePage: () => null },
  "@/lib/clinical-shared/share/summary-orthodontics": {
    buildShortOrthoSummary: async () => ({ summary: "RESUMEN-ORTO", stats: { monthInTreatment: 3 } }),
  },
};
const Mod = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = Mod._load;
Mod._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req in dobles) return dobles[req];
  if (req.startsWith(".")) {
    try {
      const f = Mod._resolveFilename(req, parent, isMain);
      if (f in doblesPorArchivo) return doblesPorArchivo[f];
    } catch { /* lo resuelve la carga original */ }
  }
  return cargaOriginal.call(this, req, parent, isMain);
};

const TOKEN = "t".repeat(43);
beforeEach(() => {
  const futuro = new Date(Date.now() + 86_400_000);
  links = {
    [TOKEN]: { id: "l1", module: "pediatrics", patientId: "pA", clinicId: "cA", expiresAt: futuro, revokedAt: null },
    ["o".repeat(43)]: { id: "l2", module: "orthodontics", patientId: "pA", clinicId: "cA", expiresAt: futuro, revokedAt: null },
    ["r".repeat(43)]: { id: "l3", module: "pediatrics", patientId: "pA", clinicId: "cA", expiresAt: futuro, revokedAt: new Date() },
    ["e".repeat(43)]: { id: "l4", module: "pediatrics", patientId: "pA", clinicId: "cA", expiresAt: new Date(Date.now() - 1000), revokedAt: null },
  };
});

test("la vista pública resuelve igual que antes: válido, orto, revocado, caducado, inexistente y corto", async () => {
  const { resolvePublicShareToken } = await import("@/lib/clinical-shared/share/resolve-public-token");
  const r: any = await resolvePublicShareToken(TOKEN);
  assert.equal(r.ok, true);
  assert.equal(r.data.patientFirstName, "Ana");
  assert.equal(r.data.clinicName, "Clínica A");
  assert.deepEqual(r.data.stats, { sealants: 2, fluorides: 1, behaviorAssessments: 3, consents: 1 });
  assert.match(r.data.summary, /Frankl 4\/4/);
  const o: any = await resolvePublicShareToken("o".repeat(43));
  assert.equal(o.data.summary, "RESUMEN-ORTO");
  assert.deepEqual(await resolvePublicShareToken("r".repeat(43)), { ok: false, error: "Link revocado" });
  assert.deepEqual(await resolvePublicShareToken("e".repeat(43)), { ok: false, error: "Link expirado" });
  assert.deepEqual(await resolvePublicShareToken("x".repeat(43)), { ok: false, error: "Link no encontrado" });
  assert.deepEqual(await resolvePublicShareToken("corto"), { ok: false, error: "Token inválido" });
});

test("la página pública sigue pintando el link (y el error de uno caducado)", async () => {
  const { default: Pagina } = await import("@/app/share/p/[token]/page");
  const html = JSON.stringify(await Pagina({ params: Promise.resolve({ token: TOKEN }) }));
  assert.match(html, /Ana/);
  assert.match(html, /Clínica A/);
  const caducado = JSON.stringify(await Pagina({ params: Promise.resolve({ token: "e".repeat(43) }) }));
  assert.match(caducado, /Link expirado/);
});

test("share-links conserva SOLO sus tres acciones legítimas (la vista pública ya no es una action)", () => {
  const src = fs.readFileSync(path.join(raiz, "src/app/actions/clinical-shared/share-links.ts"), "utf8");
  assert.match(src, /^"use server";/);
  const exportadas = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exportadas, ["createPatientShareLink", "listPatientShareLinks", "revokePatientShareLink"]);
});

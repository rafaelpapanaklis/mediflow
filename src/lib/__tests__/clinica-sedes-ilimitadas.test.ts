/**
 * PLAN CLÍNICA CON SEDES ILIMITADAS (decisión de Rafael, 5-oct-2026: «solo lo limita
 * el almacenamiento de 75 GB») y el build de Vercel con el heap explícito — ws1-t5, encargo 8.
 *
 * Run: npm run test:clinica-sedes-ilimitadas
 *
 * Se ejecuta el cupo de sucursales REAL (src/lib/branches.ts → getPlanLimitsForClinic →
 * plans.ts con sus overrides) con un doble de prisma que hace de plan_configs.
 */
import Module from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

/* ── doble de prisma: plan_configs ─────────────────────────────────────── */
let filas: Array<{ planId: string; maxClinics: number | null }> | "caida";
const fila = (planId: string, maxClinics: number | null) => ({
  planId, label: planId, priceMxnMonthly: 1, priceMxnAnnual: 1, storageBytes: BigInt(1), aiTokensDefault: 1,
  whatsappMonthly: 1, cfdiMonthly: 1, cfdiOverageCents: 1, maxPatients: null, maxUsers: null, maxClinics, features: {},
});
const prismaDoble: any = {
  planConfig: {
    findMany: async () => {
      if (filas === "caida") throw new Error("plan_configs no responde");
      return filas.map((f) => fila(f.planId, f.maxClinics));
    },
  },
};

const dobles = new Map<string, unknown>();
type M = typeof Module & {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let getBranchQuota: typeof import("@/lib/branches").getBranchQuota;
let clearPlanConfigCache: () => void;
let FALLBACK_PLAN_CONFIG: typeof import("@/lib/plan-shared").FALLBACK_PLAN_CONFIG;
let branchesBullet: typeof import("@/lib/plan-shared").branchesBullet;

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  ({ getBranchQuota } = await import("@/lib/branches"));
  ({ clearPlanConfigCache } = await import("@/lib/plans"));
  ({ FALLBACK_PLAN_CONFIG, branchesBullet } = await import("@/lib/plan-shared"));
});
beforeEach(() => {
  filas = [
    { planId: "BASIC", maxClinics: 1 },
    { planId: "PRO", maxClinics: 1 },
    { planId: "CLINIC", maxClinics: null },
  ];
  clearPlanConfigCache();
});

const dueno = (plan: string, ownedCount: number, extra: Record<string, unknown> = {}) =>
  getBranchQuota({ clinic: { plan, subscriptionStatus: "active", ...extra } as any, isOwner: true, ownedCount });

/* ── el cupo ───────────────────────────────────────────────────────────── */

test("Clínica con plan_configs en NULL: un dueño con 12 sedes puede abrir la 13.ª", async () => {
  const q = await dueno("CLINIC", 12);
  assert.equal(q.max, null);
  assert.equal(q.canCreate, true);
  assert.equal(q.blockedReason, null);
});

test("si plan_configs no responde, el RESPALDO de Clínica también es ilimitado (antes: tope de 3 → la 4.ª se bloqueaba)", async () => {
  filas = "caida";
  assert.equal(FALLBACK_PLAN_CONFIG.CLINIC.maxClinics, null);
  const q = await dueno("CLINIC", 3);
  assert.equal(q.max, null);
  assert.equal(q.canCreate, true, "la 4.ª sede se puede crear");
  assert.equal((await dueno("CLINIC", 40)).canCreate, true);
});

test("Básico y Profesional siguen en 1 sede (con plan_configs y con el respaldo): no pueden abrir sucursales", async () => {
  for (const estado of ["filas", "caida"] as const) {
    if (estado === "caida") filas = "caida";
    clearPlanConfigCache();
    for (const plan of ["BASIC", "PRO"]) {
      const q = await dueno(plan, 1);
      assert.equal(q.max, 1, `${plan} (${estado})`);
      assert.equal(q.planAllowsBranches, false, `${plan} (${estado})`);
      assert.equal(q.blockedReason, "PLAN", `${plan} (${estado})`);
    }
  }
  assert.equal(FALLBACK_PLAN_CONFIG.BASIC.maxClinics, 1);
  assert.equal(FALLBACK_PLAN_CONFIG.PRO.maxClinics, 1);
});

test("el override de 4 de las 5 clínicas Clínica: con él se topan en 4; tras el SQL (override NULL) siguen el plan → ilimitadas", async () => {
  const conTope = { planOverrideFor: "CLINIC", maxClinicsOverride: 4 };
  const antes = await dueno("CLINIC", 4, conTope);
  assert.equal(antes.max, 4);
  assert.equal(antes.blockedReason, "LIMIT");
  const despues = await dueno("CLINIC", 4, { planOverrideFor: "CLINIC", maxClinicsOverride: null });
  assert.equal(despues.max, null);
  assert.equal(despues.canCreate, true);
});

test("la portada y el plan dicen «Sedes ilimitadas» para Clínica", () => {
  assert.equal(branchesBullet(null), "Sedes ilimitadas");
  assert.equal(branchesBullet(FALLBACK_PLAN_CONFIG.CLINIC.maxClinics), "Sedes ilimitadas");
  assert.equal(branchesBullet(1), "1 sede");
});

/* ── el SQL que pega Rafael ────────────────────────────────────────────── */

test("el SQL: idempotente, solo maxClinics de CLINIC y maxClinicsOverride de las Clínica, con comprobación antes y después", () => {
  const sql = leer("sql/ws1-t5-clinica-sedes-ilimitadas.sql");
  const sinComentarios = sql.replace(/--.*$/gm, "");
  const updates = sinComentarios.match(/UPDATE[\s\S]*?;/g) ?? [];
  assert.equal(updates.length, 2);
  assert.match(updates[0], /UPDATE "plan_configs"\s+SET "maxClinics" = NULL\s+WHERE "planId" = 'CLINIC'\s+AND "maxClinics" IS NOT NULL;/);
  assert.match(updates[1], /UPDATE "clinics"\s+SET "maxClinicsOverride" = NULL\s+WHERE "planOverrideFor" = 'CLINIC'\s+AND "maxClinicsOverride" IS NOT NULL;/);
  for (const u of updates) assert.equal((u.match(/SET/g) ?? []).length, 1, "una sola columna por UPDATE");
  assert.doesNotMatch(sinComentarios, /\b(DROP|DELETE|ALTER|TRUNCATE|INSERT)\b|SET SESSION|price|maxUsers/i);
  assert.ok((sinComentarios.match(/SELECT/g) ?? []).length >= 4, "consultas de comprobación antes y después");
});

/* ── textos de la app ──────────────────────────────────────────────────── */

test("la app ya no ofrece «contratar una sucursal adicional» (no existe tal compra)", () => {
  assert.doesNotMatch(leer("src/app/api/clinics/route.ts"), /Contrata una sucursal adicional/);
  assert.doesNotMatch(leer("src/i18n/dictionaries/es.json"), /contrata una adicional/);
  assert.doesNotMatch(leer("src/i18n/dictionaries/en.json"), /purchase an additional one/);
  assert.match(leer("src/i18n/dictionaries/es.json"), /"limitReached": "Has usado \{used\}\/\{max\} sucursales de tu plan — escríbenos a soporte para abrir otra"/);
});

/* ── el build de Vercel ────────────────────────────────────────────────── */

const lanzador = require(path.join(RAIZ, "scripts/build-con-memoria.cjs")) as {
  heapParaMaquina: (bytes: number) => number;
  nodeOptionsConHeap: (actual: string | undefined, heapMb: number) => string;
};
const GB = 2 ** 30;

test("build: el heap va al 75 % de la memoria de la máquina con techo de 8 GB (Vercel Elastic 8–60 GB), no al tope de ~2–4 GB de Node", () => {
  assert.equal(lanzador.heapParaMaquina(8 * GB), 6144, "la máquina chica de 8 GB: 6 GB de heap y 2 GB para lo demás");
  assert.equal(lanzador.heapParaMaquina(10 * GB), 7680);
  assert.equal(lanzador.heapParaMaquina(16 * GB), 8192, "16 GB (Enhanced): el techo; medido, pico 10.7 GB");
  assert.equal(lanzador.heapParaMaquina(60 * GB), 8192, "la Turbo de 60 GB: el techo, para no inflar la memoria que Elastic mide");
  assert.equal(lanzador.heapParaMaquina(2 * GB), 2048, "nunca por debajo de 2 GB");
});

test("build: un --max-old-space-size explícito se respeta; lo demás de NODE_OPTIONS se conserva", () => {
  assert.equal(lanzador.nodeOptionsConHeap("--max-old-space-size=8192", 6144), "--max-old-space-size=8192");
  assert.equal(lanzador.nodeOptionsConHeap(undefined, 6144), "--max-old-space-size=6144");
  assert.equal(lanzador.nodeOptionsConHeap("--enable-source-maps", 6144), "--enable-source-maps --max-old-space-size=6144");
});

test("build: el script de npm pasa por el lanzador (Node puro: Linux y Windows, sin cross-env)", () => {
  const scripts = JSON.parse(leer("package.json")).scripts;
  assert.equal(scripts.build, "prisma generate && node scripts/build-con-memoria.cjs");
});

test("build: sin la caché persistente de webpack en producción (≈7 GB que se serializaban en memoria); en dev, la de siempre", () => {
  const cfg = leer("next.config.mjs");
  assert.match(cfg, /webpack: \(config, \{ isServer, dev \}\) => \{[\s\S]*?if \(!dev\) config\.cache = false;/);
});

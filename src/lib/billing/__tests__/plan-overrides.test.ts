/**
 * Planes nuevos (sep-2026): las clínicas YA registradas conservan sus límites y su
 * precio; las nuevas salen con las condiciones nuevas.
 *
 * Run: npm run test:planes-nuevos
 *
 * Toca COBRO y TOPES, así que se fija lo que importa:
 *  - clínica de antes (con override) → 6 usuarios (Profesional) / 4 sedes (Clínica)
 *    / su precio de hoy ($1,719 · $13,404);
 *  - clínica nueva (sin override)   → 5 usuarios / 3 sedes / $1,489 · $11,616;
 *  - cambiar de plan = condiciones nuevas del plan elegido (guarda planOverrideFor);
 *  - los sitios que aplican un tope usan la variante «ForClinic», no el plan a secas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FALLBACK_PLAN_CONFIG,
  MULTI_SEDE_BULLET,
  buildResolvedPlan,
  type ResolvedPlan,
} from "../../plan-shared";
import { planAmountCents } from "../proration";
import {
  UNLIMITED_OVERRIDE,
  activeOverrides,
  applyClinicOverrides,
  clearOverridesData,
  hasActiveOverrides,
  inheritedOverridesData,
  parseOverridesInput,
  planToLimits,
} from "../plan-overrides";

/** Los planes tal como quedan en plan_configs DESPUÉS del SQL 2 (= el fallback nuevo). */
const NEW: Record<"BASIC" | "PRO" | "CLINIC", ResolvedPlan> = {
  BASIC: buildResolvedPlan("BASIC", null),
  PRO: buildResolvedPlan("PRO", null),
  CLINIC: buildResolvedPlan("CLINIC", null),
};

/**
 * Lo que el SQL 1 congela en una clínica EXISTENTE: copia de plan_configs de hoy
 * (usuarios 2/6/∞ → ∞ se guarda como -1; sedes 1/1/4; precios 419·689·1719).
 */
const LEGACY = {
  BASIC: { plan: "BASIC", planOverrideFor: "BASIC", maxUsersOverride: 2, maxClinicsOverride: 1, priceMxnMonthlyOverride: 419, priceMxnAnnualOverride: 3264 },
  PRO: { plan: "PRO", planOverrideFor: "PRO", maxUsersOverride: 6, maxClinicsOverride: 1, priceMxnMonthlyOverride: 689, priceMxnAnnualOverride: 5376 },
  CLINIC: { plan: "CLINIC", planOverrideFor: "CLINIC", maxUsersOverride: UNLIMITED_OVERRIDE, maxClinicsOverride: 4, priceMxnMonthlyOverride: 1719, priceMxnAnnualOverride: 13404 },
} as const;

const NUEVA = (plan: "BASIC" | "PRO" | "CLINIC") => ({ plan });

// ── Las condiciones nuevas (clínica sin override) ───────────────────────────

test("el seed nuevo: usuarios 3/5/∞, sedes 1/1/3, Clínica $1,489 · $11,616", () => {
  assert.equal(NEW.BASIC.maxUsers, 3);
  assert.equal(NEW.PRO.maxUsers, 5);
  assert.equal(NEW.CLINIC.maxUsers, null);
  assert.deepEqual([NEW.BASIC.maxClinics, NEW.PRO.maxClinics, NEW.CLINIC.maxClinics], [1, 1, 3]);
  assert.equal(NEW.CLINIC.priceMxnMonthly, 1489);
  assert.equal(NEW.CLINIC.priceMxnAnnual, 11614);
});

test("anuales: Básico y Profesional no se tocan; Clínica = 1489 × 12 − 35% = 11614 (entero)", () => {
  assert.equal(FALLBACK_PLAN_CONFIG.BASIC.priceMxnAnnual, 3264);
  assert.equal(FALLBACK_PLAN_CONFIG.PRO.priceMxnAnnual, 5376);
  assert.equal(FALLBACK_PLAN_CONFIG.CLINIC.priceMxnAnnual, 11614);
  // 17868 × 0.65 = 11614.20; la columna es Int, así que se guarda el entero.
  assert.equal(Math.round(1489 * 12 * 0.65), 11614);
});

test("lo que NO cambia: CFDI 25/50/150 y su excedente, pacientes, storage, IA", () => {
  assert.deepEqual([NEW.BASIC.cfdiMonthly, NEW.PRO.cfdiMonthly, NEW.CLINIC.cfdiMonthly], [25, 50, 150]);
  assert.deepEqual([NEW.BASIC.cfdiOverageCents, NEW.PRO.cfdiOverageCents, NEW.CLINIC.cfdiOverageCents], [300, 200, 125]);
  assert.deepEqual([NEW.BASIC.maxPatients, NEW.PRO.maxPatients, NEW.CLINIC.maxPatients], [500, null, null]);
  assert.equal(NEW.BASIC.priceMxnMonthly, 419);
  assert.equal(NEW.PRO.priceMxnMonthly, 689);
});

test("una clínica NUEVA (sin override) sale con 5 / 3 / 1489", () => {
  const pro = applyClinicOverrides(NEW.PRO, NUEVA("PRO"));
  assert.equal(planToLimits(pro).maxUsers, 5);
  const clinic = applyClinicOverrides(NEW.CLINIC, NUEVA("CLINIC"));
  const limits = planToLimits(clinic);
  assert.equal(limits.maxClinics, 3);
  assert.equal(limits.monthlyPrice, 1489);
  assert.equal(clinic.priceMxnAnnual, 11614);
  assert.equal(limits.maxUsers, null);
  // Sin override el resultado es el MISMO objeto: nada se clona ni se altera.
  assert.equal(clinic, NEW.CLINIC);
});

test("sin datos, sin plan o con un select corto: se entiende «sin override»", () => {
  assert.equal(applyClinicOverrides(NEW.PRO, null), NEW.PRO);
  assert.equal(applyClinicOverrides(NEW.PRO, undefined), NEW.PRO);
  assert.equal(applyClinicOverrides(NEW.PRO, {}), NEW.PRO);
  assert.equal(activeOverrides({ plan: "PRO" }), null);
  assert.equal(hasActiveOverrides({ plan: "PRO", maxUsersOverride: 6 }), false, "sin guarda no vale");
});

// ── Las clínicas de antes conservan lo suyo ─────────────────────────────────

test("una Profesional de antes conserva 6 usuarios (no 5) y su precio", () => {
  const pro = applyClinicOverrides(NEW.PRO, LEGACY.PRO);
  assert.equal(planToLimits(pro).maxUsers, 6);
  assert.equal(pro.priceMxn, 689);
  assert.equal(pro.priceMxnAnnual, 5376);
});

test("una Básica de antes conserva 2 usuarios (no 3)", () => {
  assert.equal(planToLimits(applyClinicOverrides(NEW.BASIC, LEGACY.BASIC)).maxUsers, 2);
});

test("una Clínica de antes conserva 4 sedes (no 3), usuarios ilimitados y $1,719 / $13,404", () => {
  const c = applyClinicOverrides(NEW.CLINIC, LEGACY.CLINIC);
  const limits = planToLimits(c);
  assert.equal(limits.maxClinics, 4);
  assert.equal(limits.maxUsers, null, "-1 = ilimitado");
  assert.equal(limits.monthlyPrice, 1719);
  assert.equal(c.priceMxn, 1719);
  assert.equal(c.priceMxnMonthly, 1719);
  assert.equal(c.priceMxnAnnual, 13404);
});

test("el importe que se cobra (centavos) sale del precio conservado, mensual y anual", () => {
  const c = applyClinicOverrides(NEW.CLINIC, LEGACY.CLINIC);
  assert.equal(planAmountCents(c, "month"), 171_900);
  assert.equal(planAmountCents(c, "year"), 1_340_400);
  // La nueva paga el precio nuevo.
  assert.equal(planAmountCents(NEW.CLINIC, "month"), 148_900);
  assert.equal(planAmountCents(NEW.CLINIC, "year"), 1_161_400);
});

test("los overrides son independientes: solo los campos con valor mandan", () => {
  const soloUsuarios = applyClinicOverrides(NEW.PRO, { plan: "PRO", planOverrideFor: "PRO", maxUsersOverride: 6 });
  assert.equal(soloUsuarios.maxUsers, 6);
  assert.equal(soloUsuarios.priceMxn, NEW.PRO.priceMxn, "el precio sigue el plan");
  assert.equal(soloUsuarios.maxClinics, NEW.PRO.maxClinics);
});

test("un precio ≤ 0 se ignora: un cero nunca es «gratis» por accidente", () => {
  const c = applyClinicOverrides(NEW.PRO, { plan: "PRO", planOverrideFor: "PRO", priceMxnMonthlyOverride: 0, priceMxnAnnualOverride: -5 });
  assert.equal(c.priceMxn, NEW.PRO.priceMxn);
  assert.equal(c.priceMxnAnnual, NEW.PRO.priceMxnAnnual);
  assert.equal(activeOverrides({ plan: "PRO", planOverrideFor: "PRO", priceMxnMonthlyOverride: 0 }), null);
});

// ── Cambiar de plan = condiciones nuevas ────────────────────────────────────

test("si la clínica cambia de plan, los overrides del plan anterior dejan de valer", () => {
  // Era Profesional (6 usuarios, $689) y ahora es Clínica: aplica Clínica NUEVA.
  const ahoraClinica = { ...LEGACY.PRO, plan: "CLINIC" };
  assert.equal(hasActiveOverrides(ahoraClinica), false);
  const c = applyClinicOverrides(NEW.CLINIC, ahoraClinica);
  assert.equal(c.maxClinics, 3);
  assert.equal(c.priceMxn, 1489);
  assert.equal(c.maxUsers, null);
});

test("los overrides se aplican SOLO al plan propio: el resto de tarjetas muestra lo nuevo", () => {
  // Una Clínica de antes mirando la tarjeta de Profesional: 5 usuarios y $689.
  const pro = applyClinicOverrides(NEW.PRO, LEGACY.CLINIC);
  assert.equal(pro, NEW.PRO);
  // …y su propia tarjeta de Clínica sale con lo suyo.
  assert.equal(applyClinicOverrides(NEW.CLINIC, LEGACY.CLINIC).priceMxn, 1719);
});

test("voluntariamente a otro plan: la base del crédito es lo que paga, el destino es el precio nuevo", () => {
  const actual = applyClinicOverrides(NEW.CLINIC, LEGACY.CLINIC); // paga 1719
  const destino = NEW.PRO; // change-plan valúa el destino con el plan a secas
  assert.equal(actual.priceMxn, 1719);
  assert.equal(destino.priceMxn, 689);
});

test("clearOverridesData deja las cinco columnas en NULL", () => {
  assert.deepEqual(clearOverridesData(), {
    planOverrideFor: null,
    maxUsersOverride: null,
    maxClinicsOverride: null,
    priceMxnMonthlyOverride: null,
    priceMxnAnnualOverride: null,
  });
});

// ── Sedes ───────────────────────────────────────────────────────────────────

test("una sede nueva hereda los topes de su madre, pero no el precio", () => {
  const data = inheritedOverridesData(LEGACY.CLINIC);
  assert.equal(data.planOverrideFor, "CLINIC");
  assert.equal(data.maxUsersOverride, UNLIMITED_OVERRIDE);
  assert.equal(data.maxClinicsOverride, 4);
  assert.equal(data.priceMxnMonthlyOverride, null);
  assert.equal(data.priceMxnAnnualOverride, null);
  // La sede, ya con su fila, lee 4 sedes (mismo cupo que la madre).
  const sede = applyClinicOverrides(NEW.CLINIC, { plan: "CLINIC", ...data });
  assert.equal(sede.maxClinics, 4);
});

test("una sede de una madre NUEVA (o sin override vigente) no hereda nada", () => {
  assert.deepEqual(inheritedOverridesData({ plan: "CLINIC" }), {});
  assert.deepEqual(inheritedOverridesData(null), {});
  assert.deepEqual(inheritedOverridesData({ ...LEGACY.PRO, plan: "CLINIC" }), {}, "guarda de otro plan");
});

// ── Marketing ───────────────────────────────────────────────────────────────

test("bullets: usuarios 3/5/ilimitados y sedes 1/1/3 salen de los topes reales", () => {
  assert.equal(NEW.BASIC.features[0], "3 usuarios");
  assert.equal(NEW.PRO.features[0], "5 usuarios");
  assert.equal(NEW.CLINIC.features[0], "Usuarios ilimitados");
  assert.ok(NEW.BASIC.features.includes("1 sede"));
  assert.ok(NEW.PRO.features.includes("1 sede"));
  assert.ok(NEW.CLINIC.features.includes("Hasta 3 sedes"));
});

test("bullets: «reportes consolidados y comparación entre sedes» solo en el plan con varias sedes", () => {
  assert.equal(MULTI_SEDE_BULLET, "Reportes consolidados y comparación entre sedes");
  assert.ok(NEW.CLINIC.features.includes(MULTI_SEDE_BULLET));
  assert.ok(!NEW.BASIC.features.includes(MULTI_SEDE_BULLET));
  assert.ok(!NEW.PRO.features.includes(MULTI_SEDE_BULLET));
});

test("bullets: usuarios y pacientes siguen en 0 y 1 (las tarjetas insertan el CFDI en el 2)", () => {
  for (const p of Object.values(NEW)) {
    assert.match(p.features[0], /usuario/i);
    assert.match(p.features[1], /paciente/i);
    assert.match(p.features[2], /sede/i);
  }
});

test("bullets: la Profesional de antes ve «6 usuarios» en su tarjeta", () => {
  assert.equal(applyClinicOverrides(NEW.PRO, LEGACY.PRO).features[0], "6 usuarios");
  assert.ok(applyClinicOverrides(NEW.CLINIC, LEGACY.CLINIC).features.includes("Hasta 4 sedes"));
});

// ── Edición manual desde /admin ─────────────────────────────────────────────

test("parseOverridesInput: topes, ilimitado, precios y vacíos", () => {
  const ok = parseOverridesInput({ maxUsers: 6, maxClinics: "unlimited", priceMxnMonthly: "1719", priceMxnAnnual: "" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, {
    maxUsersOverride: 6,
    maxClinicsOverride: UNLIMITED_OVERRIDE,
    priceMxnMonthlyOverride: 1719,
    priceMxnAnnualOverride: null,
  });
  assert.equal(parseOverridesInput({}).data.maxUsersOverride, null);
});

test("parseOverridesInput rechaza cero, negativos, decimales y basura", () => {
  for (const bad of [
    { maxUsers: 0 },
    { maxUsers: -1 },
    { maxClinics: 2.5 },
    { maxClinics: "muchas" },
    { priceMxnMonthly: 0 },
    { priceMxnMonthly: -10 },
    { priceMxnAnnual: 99.5 },
    { priceMxnAnnual: "gratis" },
  ]) {
    const r = parseOverridesInput(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error);
    assert.equal(r.data, null);
  }
});

// ── Guardas de código y de SQL ──────────────────────────────────────────────

const root = join(__dirname, "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

test("los sitios que aplican un tope o cobran usan la variante por clínica", () => {
  // El tope de usuarios (alta y reactivación) y el de sedes.
  for (const f of ["src/app/api/team/route.ts", "src/app/api/team/[id]/route.ts", "src/lib/branches.ts"]) {
    const src = read(f);
    assert.ok(src.includes("getPlanLimitsForClinic("), `${f} debe usar getPlanLimitsForClinic`);
    assert.ok(!/getPlanLimits\(/.test(src), `${f} no debe leer el plan a secas`);
  }
  // El cobro: checkout, cambio de plan (+ preview) y el checkout de admin.
  assert.ok(read("src/app/api/billing/checkout/route.ts").includes("applyClinicOverrides("));
  assert.ok(read("src/app/api/billing/change-plan/route.ts").includes("getResolvedPlanForClinic("));
  assert.ok(read("src/app/api/billing/change-plan/preview/route.ts").includes("getResolvedPlanForClinic("));
  assert.ok(read("src/lib/stripe-subscriptions.ts").includes("applyClinicOverrides("));
  assert.ok(read("src/app/api/admin/billing/route.ts").includes("applyClinicOverrides("));
});

test("change-plan limpia las condiciones conservadas al cambiar de plan (los dos caminos que escriben plan)", () => {
  const src = read("src/app/api/billing/change-plan/route.ts");
  assert.equal(src.split("...clearOverridesData()").length - 1, 2);
});

test("cambiar de plan desde /admin (PATCH y activate_clinic) también limpia las condiciones", () => {
  assert.ok(read("src/app/api/admin/clinics/[id]/route.ts").includes("clearOverridesData()"));
  assert.ok(read("src/app/api/admin/billing/route.ts").includes("clearOverridesData()"));
});

test("SQL: el archivo 1 es idempotente y plano; el 2 fija los valores nuevos", () => {
  const uno = read("sql/planes-nuevos-1-conservar.sql");
  const dos = read("sql/planes-nuevos-2-precios.sql");
  for (const [n, sql] of [["1", uno], ["2", dos]] as const) {
    const sinComentarios = sql.replace(/^--.*$/gm, "");
    assert.ok(!/DO\s+\$\$/i.test(sinComentarios), `el SQL ${n} no puede llevar bloques DO $$`);
  }
  assert.equal((uno.replace(/^--.*$/gm, "").match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, 5);
  assert.ok(uno.includes('"planOverrideFor" IS NULL'), "el UPDATE no pisa lo ya rellenado");
  assert.ok(/COALESCE\(pc\."maxUsers", -1\)/.test(uno), "NULL (ilimitado) se guarda como -1");
  // Valores del paso 2, incluido el anual de Clínica confirmado por Rafael.
  assert.ok(/"maxUsers"\s*=\s*3/.test(dos) && /"maxUsers"\s*=\s*5/.test(dos));
  assert.ok(/"priceMxnMonthly"\s*=\s*1489/.test(dos));
  assert.ok(/"priceMxnAnnual"\s*=\s*11614/.test(dos));
  assert.ok(!/PENDIENTE/i.test(dos.replace(/^--.*$/gm, "")), "ya no queda marcador pendiente en las sentencias");
  // El orden importa y está escrito en mayúsculas en las dos cabeceras.
  assert.ok(uno.includes("ANTES de desplegar"));
  assert.ok(dos.includes("DESPUÉS de que el código"));
});

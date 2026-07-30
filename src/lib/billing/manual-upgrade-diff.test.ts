/**
 * Tests del DIFERENCIAL prorrateado de las clínicas sin suscripción de tarjeta
 * (SPEI/OXXO o activadas a mano por un admin), y de los casos borde del cálculo.
 *
 * Run: npm run test:billing
 *
 * Aquí vive el dinero que calculamos NOSOTROS: sin suscripción no hay prorrateo
 * de Stripe, así que un error aquí se cobra tal cual.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL_PERIOD_DAYS,
  MIN_CHARGEABLE_CENTS,
  computeManualUpgradeQuote,
  daysRemainingUntil,
  manualPaidUntil,
  manualUpgradeDiffCents,
  planAmountCents,
  resolveChangeDirection,
} from "./proration";

const BASIC = { priceMxn: 419, priceMxnAnnual: 3264 };
const PRO = { priceMxn: 689, priceMxnAnnual: 5376 };
const CLINIC = { priceMxn: 1719, priceMxnAnnual: 13404 };

const NOW = new Date("2026-07-30T12:00:00.000Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const quote = (args: {
  interval: "month" | "year" | null;
  paidUntil: Date | null;
  currentPlan?: typeof BASIC;
  targetPlan?: typeof BASIC;
}) =>
  computeManualUpgradeQuote({
    interval: args.interval,
    paidUntil: args.paidUntil,
    currentPlan: args.currentPlan ?? BASIC,
    targetPlan: args.targetPlan ?? PRO,
    now: NOW,
  });

// ── Importe correcto en mensual y anual ─────────────────────────────────────

test("mensual: cobra el delta mensual por los días que quedan", () => {
  const q = quote({ interval: "month", paidUntil: inDays(20) });
  // (68900 − 41900) × 20/30 = 18_000
  assert.equal(q.diffCents, 18_000);
  assert.equal(q.periodDays, 30);
  assert.equal(q.daysRemaining, 20);
  assert.equal(q.direction, "upgrade");
  assert.equal(q.chargeable, true);
});

test("anual: cobra el delta ANUAL sobre 365 días, no el mensual", () => {
  const q = quote({ interval: "year", paidUntil: inDays(300) });
  // (537600 − 326400) × 300/365 = 173_589.04 → 173_589
  assert.equal(q.diffCents, 173_589);
  assert.equal(q.periodDays, 365);
  assert.equal(q.interval, "year");
});

test("el periodo NO se extiende: periodEnd sigue siendo el pagado-hasta", () => {
  const paidUntil = inDays(20);
  const q = quote({ interval: "month", paidUntil });
  assert.equal(q.periodEnd?.toISOString(), paidUntil.toISOString());
});

// ── Ciclo desconocido: nunca sobre-cobrar ───────────────────────────────────

test("ciclo desconocido: cotiza AMBOS y cobra el MENOR (nunca sobre-cobra)", () => {
  // El bug que esto evita: caer a "month" para una clínica ANUAL cobraba el
  // delta mensual × 300/30 = 10 mensualidades de diferencia, ~56% de más.
  const unknown = quote({ interval: null, paidUntil: inDays(300) });
  const asMonthly = quote({ interval: "month", paidUntil: inDays(300) });
  const asAnnual = quote({ interval: "year", paidUntil: inDays(300) });

  assert.equal(asMonthly.diffCents, 270_000, "mensual × 10 periodos");
  assert.equal(asAnnual.diffCents, 173_589);
  assert.equal(unknown.diffCents, asAnnual.diffCents, "debe elegir el más barato");
  assert.ok(unknown.diffCents < asMonthly.diffCents);
  assert.equal(unknown.intervalKnown, false, "se marca como no confirmado para auditarlo");
});

test("ciclo desconocido con pocos días: el mensual es el más barato y gana", () => {
  const unknown = quote({ interval: null, paidUntil: inDays(10) });
  const asMonthly = quote({ interval: "month", paidUntil: inDays(10) });
  const asAnnual = quote({ interval: "year", paidUntil: inDays(10) });
  // mensual: 27000×10/30 = 9_000 · anual: 211200×10/365 = 5_786 → gana el anual
  assert.equal(unknown.diffCents, Math.min(asMonthly.diffCents, asAnnual.diffCents));
});

test("ciclo confirmado: se respeta aunque sea el más caro", () => {
  const q = quote({ interval: "month", paidUntil: inDays(300) });
  assert.equal(q.intervalKnown, true);
  assert.equal(q.diffCents, 270_000, "si sabemos que es mensual, se cobra como mensual");
});

// ── Dirección: plan inferior / mismo plan ───────────────────────────────────

test("plan inferior al actual → diferencial 0 (nunca negativo, sin devolución)", () => {
  const q = quote({ interval: "month", paidUntil: inDays(20), currentPlan: CLINIC, targetPlan: BASIC });
  assert.equal(q.direction, "downgrade");
  assert.equal(q.diffCents, 0);
  assert.equal(q.chargeable, false);
});

test("mismo precio → 'same' y no se cobra nada", () => {
  const q = quote({ interval: "month", paidUntil: inDays(20), currentPlan: PRO, targetPlan: { ...PRO } });
  assert.equal(q.direction, "same");
  assert.equal(q.diffCents, 0);
});

test("idempotencia del importe: cotizar dos veces con el mismo ahora da lo mismo", () => {
  const a = quote({ interval: "month", paidUntil: inDays(20) });
  const b = quote({ interval: "month", paidUntil: inDays(20) });
  assert.equal(a.diffCents, b.diffCents);
});

// ── Casos borde de los días ─────────────────────────────────────────────────

test("0 días restantes → no hay nada que prorratear", () => {
  const q = quote({ interval: "month", paidUntil: NOW });
  assert.equal(q.daysRemaining, 0);
  assert.equal(q.diffCents, 0);
  assert.equal(q.chargeable, false);
});

test("periodo YA VENCIDO → 0 días (nunca negativo)", () => {
  const q = quote({ interval: "month", paidUntil: inDays(-45) });
  assert.equal(q.daysRemaining, 0);
  assert.equal(q.diffCents, 0);
});

test("1 día restante → se prorratea un día", () => {
  const q = quote({ interval: "month", paidUntil: inDays(1) });
  assert.equal(q.daysRemaining, 1);
  assert.equal(q.diffCents, 900, "27000/30 = 900");
});

test("sin fecha de pagado-hasta → 0 días, sin cobro", () => {
  const q = quote({ interval: "month", paidUntil: null });
  assert.equal(q.daysRemaining, 0);
  assert.equal(q.diffCents, 0);
  assert.equal(q.periodEnd, null);
});

test("daysRemainingUntil no depende de la zona horaria (es duración, no calendario)", () => {
  // Mismo instante expresado en dos offsets: mismo resultado.
  const utc = new Date("2026-08-19T06:00:00.000Z");
  const mx = new Date("2026-08-19T00:00:00.000-06:00");
  assert.equal(utc.getTime(), mx.getTime());
  assert.equal(daysRemainingUntil(utc, NOW), daysRemainingUntil(mx, NOW));
});

test("un diferencial por debajo del mínimo de Stripe no es cobrable", () => {
  // Delta de $1 con 1 día restante: 100×1/30 = 3 centavos.
  const q = quote({
    interval: "month",
    paidUntil: inDays(1),
    currentPlan: { priceMxn: 419, priceMxnAnnual: 3264 },
    targetPlan: { priceMxn: 420, priceMxnAnnual: 3265 },
  });
  assert.ok(q.diffCents > 0);
  assert.ok(q.diffCents < MIN_CHARGEABLE_CENTS);
  assert.equal(q.chargeable, false);
});

test("el redondeo es un solo Math.round: máximo medio centavo de error", () => {
  const raw = ((68_900 - 41_900) * 20) / 30;
  assert.equal(
    manualUpgradeDiffCents({
      currentCents: 41_900,
      targetCents: 68_900,
      daysRemaining: 20,
      periodDays: MANUAL_PERIOD_DAYS.month,
    }),
    Math.round(raw),
  );
});

// ── "Pagado-hasta": trialEndsAt vs nextBillingDate ──────────────────────────

test("manualPaidUntil toma la fecha MAYOR de las dos", () => {
  // El caso que regalaba upgrades: el admin activa la clínica y escribe
  // nextBillingDate (+12 meses) dejando trialEndsAt vencido desde el registro.
  const activadaPorAdmin = { trialEndsAt: inDays(-200), nextBillingDate: inDays(165) };
  assert.equal(manualPaidUntil(activadaPorAdmin)?.toISOString(), inDays(165).toISOString());

  const speiNormal = { trialEndsAt: inDays(20), nextBillingDate: null };
  assert.equal(manualPaidUntil(speiNormal)?.toISOString(), inDays(20).toISOString());

  assert.equal(manualPaidUntil({ trialEndsAt: null, nextBillingDate: null }), null);
  assert.equal(manualPaidUntil({}), null);
});

test("clínica activada por admin: SÍ se le cobra el diferencial de su periodo", () => {
  const paidUntil = manualPaidUntil({ trialEndsAt: inDays(-200), nextBillingDate: inDays(165) });
  const q = quote({ interval: "month", paidUntil });
  assert.equal(q.daysRemaining, 165);
  assert.ok(q.chargeable, "leyendo solo trialEndsAt esto daba 0 días y el upgrade salía gratis");
});

test("manualPaidUntil ignora fechas inválidas en vez de romper", () => {
  assert.equal(manualPaidUntil({ trialEndsAt: "no-es-fecha", nextBillingDate: inDays(10) })?.toISOString(), inDays(10).toISOString());
  assert.equal(manualPaidUntil({ trialEndsAt: "no-es-fecha", nextBillingDate: null }), null);
});

// ── Precios cambiados en plan_configs después de contratar ──────────────────

test("el precio del plan cambió: bajar de TIER nunca se cobra hoy", () => {
  // Clínica con PRO grandfathered a $689; el admin sube BASIC a $749.
  // Por importe sería "upgrade" (74900 > 68900) y se le cobraría de inmediato
  // con error_if_incomplete por DEGRADARSE, con copy de "diferencia del upgrade".
  const direction = resolveChangeDirection({
    currentCents: 68_900,
    targetCents: 74_900,
    currentPlanId: "PRO",
    targetPlanId: "BASIC",
  });
  assert.equal(direction, "downgrade");
});

test("el precio del plan cambió: subir de TIER más barato NO fuerza cobro inmediato", () => {
  // CLINIC quedó más barato que el PRO congelado del cliente: no hay diferencia
  // que cobrar hoy, y el crédito se aplica a la próxima factura.
  assert.equal(
    resolveChangeDirection({
      currentCents: 149_900,
      targetCents: 129_900,
      currentPlanId: "PRO",
      targetPlanId: "CLINIC",
    }),
    "downgrade",
  );
});

test("caso normal: sube tier y sube importe → upgrade", () => {
  assert.equal(
    resolveChangeDirection({
      currentCents: planAmountCents(BASIC, "month"),
      targetCents: planAmountCents(PRO, "month"),
      currentPlanId: "BASIC",
      targetPlanId: "PRO",
    }),
    "upgrade",
  );
});

test("plan desconocido (legacy): sin veto, manda el importe", () => {
  assert.equal(
    resolveChangeDirection({ currentCents: 41_900, targetCents: 68_900, currentPlanId: "LEGACY", targetPlanId: "PRO" }),
    "upgrade",
  );
  assert.equal(
    resolveChangeDirection({ currentCents: 41_900, targetCents: 68_900, currentPlanId: null, targetPlanId: null }),
    "upgrade",
  );
});

test("mismo importe: ni upgrade ni downgrade, sin importar el tier", () => {
  assert.equal(
    resolveChangeDirection({ currentCents: 68_900, targetCents: 68_900, currentPlanId: "PRO", targetPlanId: "CLINIC" }),
    "same",
  );
});

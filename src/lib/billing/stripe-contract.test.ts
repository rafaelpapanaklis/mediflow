/**
 * Tests de CONTRATO con Stripe: verifican el objeto que se ENVIARÍA, sin
 * enviarlo. No hay entorno Stripe TEST (todo es LIVE), así que ninguna prueba
 * puede tocar la API real — pero sí podemos congelar los parámetros exactos que
 * deciden cuánto se cobra y cuándo.
 *
 * Run: npm run test:billing
 *
 * Los 3 invariantes que sostienen el negocio del upgrade:
 *   (a) `always_invoice` SOLO en upgrade — cobra hoy el diferencial.
 *   (b) `error_if_incomplete` presente en upgrade — si la tarjeta rechaza, el
 *       plan superior NO queda aplicado gratis.
 *   (c) `billing_cycle_anchor` AUSENTE siempre — es lo que preserva la fecha de
 *       renovación; fijarlo reiniciaría el ciclo y regalaría/cobraría un periodo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildPreviewSubscriptionItems,
  buildSubscriptionUpdateParams,
  buildTargetPriceParams,
  hasProrationLines,
  hasRenewalLine,
  mapPreviewLines,
  planAmountCents,
  previewAmountDueNow,
  subscriptionItemInterval,
} from "./proration";

const BASIC = { id: "BASIC", name: "Básico", priceMxn: 499, priceMxnAnnual: 3893 };
const PRO = { id: "PRO", name: "Profesional", priceMxn: 999, priceMxnAnnual: 7792 };

const META = { clinicId: "cl_1", plan: "PRO", kind: "platform-subscription" };
const updateParams = (direction: "upgrade" | "downgrade" | "same") =>
  buildSubscriptionUpdateParams({ itemId: "si_1", priceId: "price_new", direction, metadata: META });

// ── (a) proration_behavior ──────────────────────────────────────────────────

test("upgrade → always_invoice (el diferencial se cobra HOY)", () => {
  assert.equal(updateParams("upgrade").proration_behavior, "always_invoice");
});

test("downgrade → create_prorations (crédito a la próxima factura, no cobra hoy)", () => {
  assert.equal(updateParams("downgrade").proration_behavior, "create_prorations");
});

test("cambio sin diferencia de precio → create_prorations, nunca always_invoice", () => {
  assert.equal(updateParams("same").proration_behavior, "create_prorations");
});

// ── (b) payment_behavior ────────────────────────────────────────────────────

test("upgrade → payment_behavior error_if_incomplete", () => {
  assert.equal(updateParams("upgrade").payment_behavior, "error_if_incomplete");
});

test("downgrade → SIN payment_behavior (no cobra nada; exigirlo lo haría fallar)", () => {
  const params = updateParams("downgrade");
  assert.equal("payment_behavior" in params, false, "la llave NO debe existir, ni siquiera undefined");
  assert.equal("payment_behavior" in updateParams("same"), false);
});

// ── (c) billing_cycle_anchor: JAMÁS ─────────────────────────────────────────

/** Todas las llaves del objeto, recursivo. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v) => deepKeys(v, out));
  } else if (value && typeof value === "object") {
    Object.keys(value as Record<string, unknown>).forEach((k) => {
      out.push(k);
      deepKeys((value as Record<string, unknown>)[k], out);
    });
  }
  return out;
}

test("billing_cycle_anchor NUNCA viaja en el update (preserva la fecha de renovación)", () => {
  const directions: Array<"upgrade" | "downgrade" | "same"> = ["upgrade", "downgrade", "same"];
  directions.forEach((direction) => {
    const params = updateParams(direction);
    assert.equal(
      deepKeys(params).indexOf("billing_cycle_anchor"),
      -1,
      `billing_cycle_anchor presente en ${direction}`,
    );
    // Doble red: también en el JSON serializado que realmente sale al request.
    assert.equal(JSON.stringify(params).includes("billing_cycle_anchor"), false);
  });
});

test("billing_cycle_anchor no aparece como CÓDIGO en los módulos de billing", () => {
  const files = [
    "src/lib/billing/proration.ts",
    "src/app/api/billing/change-plan/route.ts",
    "src/app/api/billing/change-plan/preview/route.ts",
    "src/app/api/webhooks/stripe/route.ts",
  ];
  files.forEach((rel) => {
    const source = readFileSync(path.join(process.cwd(), rel), "utf8");
    const offenders = source
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      // Las menciones en comentarios son la documentación del invariante.
      .filter((l) => l.line.indexOf("billing_cycle_anchor") >= 0)
      .filter((l) => !(l.line.startsWith("*") || l.line.startsWith("//") || l.line.startsWith("/*")));
    assert.deepEqual(offenders, [], `${rel}: billing_cycle_anchor en código`);
  });
});

// ── Estructura del update ───────────────────────────────────────────────────

test("el update reemplaza el price DEL MISMO item y arrastra la metadata", () => {
  const params = updateParams("upgrade");
  assert.deepEqual(params.items, [{ id: "si_1", price: "price_new" }]);
  assert.deepEqual(params.metadata, META);
});

// ── El price destino respeta el INTERVALO actual ────────────────────────────

test("suscripción MENSUAL → price mensual con el importe mensual del plan", () => {
  const price = buildTargetPriceParams(PRO, "month");
  assert.equal(price.unit_amount, 99_900);
  assert.equal(price.recurring.interval, "month");
  assert.equal(price.currency, "mxn");
  assert.match(price.product_data.name, /mensual/);
  assert.equal(price.product_data.metadata.plan, "PRO");
});

test("suscripción ANUAL sigue ANUAL: nunca se convierte a mensual al cambiar de plan", () => {
  const price = buildTargetPriceParams(PRO, "year");
  assert.equal(price.unit_amount, 779_200, "debe usar priceMxnAnnual, no priceMxn");
  assert.equal(price.recurring.interval, "year");
  assert.match(price.product_data.name, /anual/);
});

test("subscriptionItemInterval: lee el intervalo real y cae a mensual si falta", () => {
  assert.equal(subscriptionItemInterval({ price: { recurring: { interval: "year" } } }), "year");
  assert.equal(subscriptionItemInterval({ price: { recurring: { interval: "month" } } }), "month");
  // Default defensivo: sin `recurring` preferimos el ciclo que cobra MENOS.
  assert.equal(subscriptionItemInterval({ price: { recurring: null } }), "month");
  assert.equal(subscriptionItemInterval({ price: {} }), "month");
  assert.equal(subscriptionItemInterval(null), "month");
  assert.equal(subscriptionItemInterval(undefined), "month");
});

// ── Item de la simulación (preview) ─────────────────────────────────────────

test("el preview simula el MISMO item con el importe destino y el product actual", () => {
  const items = buildPreviewSubscriptionItems({
    itemId: "si_1",
    quantity: 1,
    currency: "mxn",
    productId: "prod_actual",
    interval: "year",
    targetCents: planAmountCents(PRO, "year"),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "si_1");
  assert.equal(items[0].price_data.product, "prod_actual", "reutiliza el product: no ensucia Stripe");
  assert.equal(items[0].price_data.unit_amount, 779_200);
  assert.equal(items[0].price_data.recurring.interval, "year", "el preview debe simular el ciclo REAL");
});

test("el preview cotiza el MISMO importe que se enviará en el update", () => {
  // Si estos dos divergen, el cliente ve un número y se le cobra otro.
  const intervals: Array<"month" | "year"> = ["month", "year"];
  intervals.forEach((interval) => {
    const previewCents = buildPreviewSubscriptionItems({
      itemId: "si_1",
      quantity: 1,
      currency: "mxn",
      productId: "prod_1",
      interval,
      targetCents: planAmountCents(PRO, interval),
    })[0].price_data.unit_amount;
    assert.equal(previewCents, buildTargetPriceParams(PRO, interval).unit_amount, `interval=${interval}`);
  });
});

// ── Mapeo de las líneas de la factura simulada ──────────────────────────────

test("hasProrationLines: sin líneas de prorrateo la simulación NO es del upgrade", () => {
  assert.equal(hasProrationLines([]), false);
  assert.equal(hasProrationLines([{ proration: false }]), false);
  assert.equal(hasProrationLines([{}]), false);
  assert.equal(hasProrationLines([{ proration: false }, { proration: true }]), true);
});

test("mapPreviewLines: crédito y cargo se describen con los planes reales", () => {
  const lines = mapPreviewLines(
    [
      { proration: true, amount: -33_300 },
      { proration: true, amount: 66_600 },
      { proration: false, amount: 12_000, description: "Excedente CFDI" },
    ],
    { currentPlanName: BASIC.name, targetPlanName: PRO.name, daysRemaining: 20 },
  );
  assert.equal(lines[0].amount, -333);
  assert.match(lines[0].description, /Crédito/);
  assert.match(lines[0].description, new RegExp(BASIC.name));
  assert.equal(lines[1].amount, 666);
  assert.match(lines[1].description, new RegExp(PRO.name));
  assert.match(lines[1].description, /20 día/);
  // Las líneas ajenas al prorrateo (excedentes CFDI) conservan su descripción.
  assert.equal(lines[2].description, "Excedente CFDI");
  assert.equal(lines[2].amount, 120);
});

test("previewAmountDueNow: un crédito neto se muestra como 0, nunca como cobro negativo", () => {
  assert.equal(previewAmountDueNow({ amount_due: 66_600 }), 666);
  assert.equal(previewAmountDueNow({ amount_due: -5_000 }), 0);
  assert.equal(previewAmountDueNow({ amount_due: 0 }), 0);
  assert.equal(previewAmountDueNow({}), 0);
  assert.equal(previewAmountDueNow(null), 0);
});

// ── La simulación no puede colar la RENOVACIÓN como "se cobra hoy" ──────────

const PERIOD_END = 1_800_000_000;
const prorationLine = (amount: number) => ({ proration: true, amount, period: { start: PERIOD_END - 500_000 } });
/** Línea del ciclo SIGUIENTE: sin prorrateo y con periodo que arranca al vencer el actual. */
const renewalLine = (amount: number) => ({ proration: false, amount, period: { start: PERIOD_END, end: PERIOD_END + 2_592_000 } });
/** Excedente CFDI pendiente: sin prorrateo, pero del periodo de HOY. */
const overageLine = (amount: number) => ({ proration: false, amount, period: { start: PERIOD_END - 400_000 } });

test("hasRenewalLine distingue la renovación de un excedente pendiente", () => {
  assert.equal(hasRenewalLine([prorationLine(66_600), renewalLine(171_900)], PERIOD_END), true);
  assert.equal(hasRenewalLine([prorationLine(66_600), overageLine(12_000)], PERIOD_END), false);
  assert.equal(hasRenewalLine([prorationLine(66_600)], PERIOD_END), false);
  assert.equal(hasRenewalLine([], PERIOD_END), false);
  // Sin fin de periodo conocido no se puede discriminar: no se bloquea.
  assert.equal(hasRenewalLine([renewalLine(171_900)], null), false);
});

test("si la simulación trae la renovación, NO se muestra importe (null → no disponible)", () => {
  // `createPreview` / `/v1/invoices/upcoming` pueden devolver la factura del
  // próximo ciclo: ahí `amount_due` = prorrateo + periodo COMPLETO del plan
  // nuevo. Mostrarlo como cobro de hoy multiplicaba el número en pantalla.
  const invoice = {
    amount_due: 238_500,
    lines: { data: [prorationLine(66_600), renewalLine(171_900)] },
  };
  assert.equal(previewAmountDueNow(invoice, PERIOD_END), null);
});

test("factura de prorrateo legítima (con excedente CFDI incluido) sí muestra importe", () => {
  const invoice = {
    amount_due: 78_600,
    lines: { data: [prorationLine(-33_300), prorationLine(99_900), overageLine(12_000)] },
  };
  assert.equal(previewAmountDueNow(invoice, PERIOD_END), 786);
});

// ── always_invoice solo en la rama de upgrade ───────────────────────────────

test("always_invoice: en proration.ts vive SOLO en el ternario de upgrade", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/billing/proration.ts"), "utf8");
  const codeLines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !(l.startsWith("*") || l.startsWith("//") || l.startsWith("/*")))
    .filter((l) => l.indexOf('"always_invoice"') >= 0);
  // 1) la declaración del tipo, 2) el ternario. Nada más.
  assert.equal(codeLines.length, 2, `líneas con always_invoice: ${JSON.stringify(codeLines)}`);
  assert.ok(
    codeLines.some((l) => l.indexOf("isUpgrade ?") >= 0),
    "el único uso ejecutable debe estar condicionado a isUpgrade",
  );
  assert.ok(codeLines.some((l) => l.indexOf("proration_behavior:") >= 0));
});

test("always_invoice en el preview: solo después del guard `direction !== upgrade`", () => {
  const lines = readFileSync(
    path.join(process.cwd(), "src/app/api/billing/change-plan/preview/route.ts"),
    "utf8",
  ).split("\n");

  const isComment = (l: string) => {
    const t = l.trim();
    return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
  };
  const guardLine = lines.findIndex((l) => !isComment(l) && l.indexOf('direction !== "upgrade"') >= 0);
  assert.ok(guardLine > 0, "el guard que corta el downgrade debe existir");

  // Toda simulación con always_invoice (createPreview y el fallback legacy)
  // tiene que quedar DESPUÉS del guard: en downgrade no se simula un cobro.
  const uses = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !isComment(l) && l.indexOf('"always_invoice"') >= 0);
  assert.ok(uses.length >= 1, "el preview debe simular con always_invoice");
  uses.forEach(({ i, l }) => {
    assert.ok(i > guardLine, `always_invoice en la línea ${i + 1} está antes del guard: ${l.trim()}`);
  });
});

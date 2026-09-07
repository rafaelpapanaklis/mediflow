/**
 * El IVA que enseña el editor de facturas contra el que se guarda.
 *
 * Run: npm run test:editor-iva
 *
 * El fallo, en una línea: `invoice-editor-modal.tsx` calculaba el impuesto con
 * `round2(base × tasa)` sobre la base AGREGADA, mientras el servidor y el
 * timbrado lo redondean **por concepto y lo suman** (criterio del SAT: el CFDI
 * manda `taxes` dentro de cada línea y Facturapi redondea línea por línea).
 * Con IVA agregado y varios conceptos los dos criterios dan números distintos:
 * la pantalla decía $3,093.30 y se guardaba $3,093.28.
 *
 * Qué fija este archivo:
 *   1 · el caso medido, con sus cifras exactas;
 *   2 · que el criterio que usa ahora el modal (`cfdiTotalBreakdown`, el mismo
 *       que predice lo que timbra Facturapi) coincide SIEMPRE con el criterio
 *       por concepto, y que el viejo NO;
 *   3 · que los otros dos modos —exento e IVA incluido— no se mueven: ahí el
 *       total es la base, y la base es la misma por los dos caminos. Esto es lo
 *       que responde a "¿diverge también el modo incluido?": no, y aquí está
 *       la prueba en vez de la promesa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotals, round2 } from "../../quotes/compute";
import { cfdiTotalBreakdown, IVA_RATE_PCT } from "../../invoice-totals";

const R = IVA_RATE_PCT / 100;

/** Lo que hacía el modal ANTES: impuesto sobre la base agregada. */
function totalCriterioViejo(base: number, taxIncluded: boolean): number {
  if (taxIncluded) return round2(base);
  return round2(base + round2(base * R));
}

/** Lo que hace AHORA: exactamente lo que el modal pide a cfdiTotalBreakdown. */
function totalDelModal(
  items: { name: string; quantity: number; unitPrice: number; discount: number }[],
  opts: { discountPct?: number | null; discountAmount?: number | null },
  taxMode: "exento" | "iva16",
  taxIncluded: boolean,
) {
  const totals = computeTotals(items, opts);
  // Mismo clamp del descuento de línea que aplica el modal (helper lineDiscount):
  // preview y payload salen de la misma línea, si no vuelven a divergir.
  const lineas = totals.items.map((it) => ({
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discount: Math.min(it.discount, round2(it.unitPrice * it.quantity)),
  }));
  const bd = cfdiTotalBreakdown(lineas, totals.discountAmount, taxMode, taxIncluded);
  const base = round2(Math.max(0, bd.base));
  if (taxMode !== "iva16" || taxIncluded) return { base, total: base };
  return { base, total: round2(base + bd.tax) };
}

const linea = (unitPrice: number, quantity = 1, discount = 0) =>
  ({ name: "x", quantity, unitPrice, discount });

// ── 1 · El caso medido, con sus cifras ──────────────────────────────────

test("REGRESIÓN: la pantalla decía 3,093.30 y se guardaba 3,093.28", () => {
  const items = [549.84, 960.53, 922.78, 193.46, 40.03].map((p) => linea(p));
  const { base, total } = totalDelModal(items, {}, "iva16", false);

  assert.equal(base, 2666.64, "premisa: la base de los cinco conceptos");
  assert.equal(
    totalCriterioViejo(base, false),
    3093.30,
    "premisa del fallo: el criterio agregado daba 3,093.30",
  );
  assert.equal(total, 3093.28, "el modal tiene que decir lo que se guarda");
  assert.notEqual(total, totalCriterioViejo(base, false), "y por tanto NO el viejo");
});

// ── 2 · El criterio nuevo es el del SAT, siempre ────────────────────────

test("el total del modal es SIEMPRE el del criterio por concepto", () => {
  let divergen = 0;
  const CASOS = 20000;
  for (let i = 0; i < CASOS; i++) {
    const n = 1 + (i % 8);
    const items = Array.from({ length: n }, () => linea(round2(20 + Math.random() * 1500)));
    const { base, total } = totalDelModal(items, {}, "iva16", false);

    // El criterio por concepto, calculado aquí a mano sobre las mismas líneas.
    const bases = items.map((it) => round2(it.quantity * it.unitPrice));
    const esperado = round2(base + round2(bases.reduce((s, b) => s + round2(b * R), 0)));
    assert.equal(total, esperado, `caso ${i}: el modal se salió del criterio del SAT`);

    if (total !== totalCriterioViejo(base, false)) divergen++;
  }
  // No se fija un porcentaje exacto (es aleatorio), solo que el fallo era real
  // y frecuente: medido por el gerente, el 37,3 % de las facturas con IVA
  // agregado. Si esto bajara a 0, el test de arriba habría dejado de medir nada.
  assert.ok(
    divergen > CASOS * 0.2,
    `los dos criterios apenas divergen (${divergen}/${CASOS}): el caso de prueba dejó de ser representativo`,
  );
});

// ── 3 · Los otros dos modos NO se mueven ────────────────────────────────

test("exento e IVA incluido: el total es la base y la base no cambia", () => {
  for (let i = 0; i < 20000; i++) {
    const n = 1 + (i % 8);
    const items = Array.from({ length: n }, () =>
      linea(round2(20 + Math.random() * 1500), 1 + (i % 3), round2(Math.random() * 30)),
    );
    // Con descuento global, en sus dos formas, que es donde el prorrateo por
    // línea podría haber movido la base respecto del cálculo agregado.
    const opts = i % 2 === 0
      ? { discountAmount: round2(Math.random() * 200) }
      : { discountPct: round2(Math.random() * 25) };

    const totals = computeTotals(items, opts);
    for (const [taxMode, taxIncluded] of [["exento", true], ["iva16", true]] as const) {
      const { base, total } = totalDelModal(items, opts, taxMode, taxIncluded);
      assert.equal(base, totals.total, `caso ${i}: la base se movió (${taxMode})`);
      assert.equal(total, round2(totals.total), `caso ${i}: el total se movió (${taxMode})`);
      assert.equal(total, totalCriterioViejo(totals.total, true), `caso ${i}: divergió del viejo`);
    }
  }
});

test("con IVA agregado la base tampoco se mueve: lo único que cambia es el impuesto", () => {
  for (let i = 0; i < 5000; i++) {
    const n = 1 + (i % 6);
    const items = Array.from({ length: n }, () => linea(round2(20 + Math.random() * 900)));
    const opts = { discountAmount: round2(Math.random() * 150) };
    const totals = computeTotals(items, opts);
    const { base } = totalDelModal(items, opts, "iva16", false);
    assert.equal(base, totals.total, `caso ${i}: la base del IVA agregado se movió`);
  }
});

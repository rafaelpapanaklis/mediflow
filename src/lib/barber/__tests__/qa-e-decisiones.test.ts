/**
 * QA de cierre E — decisiones del 16-nov-2026 (las tomó el gerente; Rafael
 * puede cambiarlas). Aquí va lo PURO de cada una; lo que pide base está en
 * qa-e-decisiones-integration.test.ts.
 *
 *   npx tsx --test src/lib/barber/__tests__/qa-e-decisiones.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getBarberT } from "@/i18n/dictionaries/barber";

// ── Decisión 4: el texto de «Te queda hoy» ──────────────────────────────

test("D4: «Te queda hoy» dice la cuenta que hace, la misma de la Ganancia de Reportes (es y en)", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.inicio.money.profitHint"), "Ingresos − gastos − lo que les toca a los barberos");
  assert.equal(es("barber.inicio.money.profitHint"), es("barber.reportes.money.profitHint"));
  assert.equal(en("barber.inicio.money.profitHint"), en("barber.reportes.money.profitHint"));
  assert.notEqual(en("barber.inicio.money.profitHint"), es("barber.inicio.money.profitHint"));
});

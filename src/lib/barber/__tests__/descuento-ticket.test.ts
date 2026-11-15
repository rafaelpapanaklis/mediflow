// QA B (15-nov-2026) · Caja: descuento del ticket en % o en $.
//
// En panel.108 el ticket solo aceptaba pesos: «10%» dejaba «Cobrar»
// deshabilitado sin decir por qué, y un descuento mayor que el total dejaba
// el ticket en $0 sin avisar. Ahora hay modo $ / %, «10%» escrito se entiende
// como porcentaje, y cada caso dice qué pasa. Al servidor sigue llegando un
// MONTO, calculado sobre la misma base (después del bono).
//
//   npx tsx --test src/lib/barber/__tests__/descuento-ticket.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ticketDiscountCents } from "@/components/barber/cash/money";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";

test("en pesos: igual que antes ($18 sobre $180 = 1800 centavos)", () => {
  assert.deepEqual(ticketDiscountCents(18000, "18", "amount"), { cents: 1800, invalid: false, capped: false, reason: null });
  assert.deepEqual(ticketDiscountCents(18000, "", "amount"), { cents: 0, invalid: false, capped: false, reason: null });
  assert.deepEqual(ticketDiscountCents(18000, "18.50", "amount").cents, 1850);
});

test("en %: 10 % de $180 = $18; con centavos se redondea al centavo", () => {
  assert.equal(ticketDiscountCents(18000, "10", "pct").cents, 1800);
  assert.equal(ticketDiscountCents(14999, "15", "pct").cents, 2250, "15 % de $149.99 = $22.4985 → $22.50");
  assert.equal(ticketDiscountCents(18000, "100", "pct").cents, 18000);
  assert.deepEqual(ticketDiscountCents(18000, "150", "pct"), { cents: 0, invalid: true, capped: false, reason: "percent" });
});

test("🔴 «10%» escrito en modo pesos se entiende como porcentaje (antes bloqueaba «Cobrar» en silencio)", () => {
  assert.deepEqual(ticketDiscountCents(18000, "10%", "amount"), { cents: 1800, invalid: false, capped: false, reason: null });
  assert.deepEqual(ticketDiscountCents(18000, "10 %", "amount").cents, 1800);
});

test("texto que no es número: no se cobra y hay motivo", () => {
  assert.deepEqual(ticketDiscountCents(18000, "diez", "amount"), { cents: 0, invalid: true, capped: false, reason: "format" });
  assert.deepEqual(ticketDiscountCents(18000, "-5", "pct"), { cents: 0, invalid: true, capped: false, reason: "format" });
});

test("más que el total: se cobra $0 y se avisa (capped)", () => {
  assert.deepEqual(ticketDiscountCents(18000, "500", "amount"), { cents: 18000, invalid: false, capped: true, reason: null });
});

test("el ticket usa el cálculo y dice cada caso en es y en", () => {
  const src = readFileSync(join(__dirname, "../../../components/barber/cash/ticket-modal.tsx"), "utf8");
  assert.match(src, /ticketDiscountCents\(grossAfterBonus, discountText, discountMode\)/);
  for (const locale of ["es", "en"] as const) {
    const tk = (((getBarberDict(locale) as Dictionary).barber as Dictionary).caja as Dictionary).ticket as Dictionary;
    for (const k of ["discountMode", "discountInvalid", "discountPercentMax", "discountCapped", "discountPctApplied"]) {
      assert.equal(typeof tk[k], "string", `${locale}: falta ticket.${k}`);
    }
    assert.match(String(tk.discountPctApplied), /\{amount\}/);
  }
});

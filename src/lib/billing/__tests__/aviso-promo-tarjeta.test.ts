/**
 * Promo del primer mes SOLO con tarjeta (encargo 9, decisión de Rafael): textos puros con números y
 * candados de dónde se muestran. Run: npx tsx --test src/lib/billing/__tests__/aviso-promo-tarjeta.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_MONTH_PROMO_MXN, FALLBACK_PLAN_CONFIG } from "@/lib/plan-shared";
import { desgloseConIva } from "@/lib/billing/iva-cobro";
import { avisoPromoSoloConTarjeta, botonPagarConTarjetaPromo, lineaDespuesDelPrimerMes, lineaPrimerMesConTarjeta } from "../aviso-promo-tarjeta";

const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("3 planes: la línea del primer mes con tarjeta y el aviso de SPEI/OXXO dicen lo correcto", () => {
  const esperado = {
    BASIC: { promo: "$19", mensual: "$419", completo: "$486.04" },
    PRO: { promo: "$29", mensual: "$689", completo: "$799.24" },
    CLINIC: { promo: "$39", mensual: "$1,489", completo: "$1,727.24" },
  } as const;
  for (const id of ["BASIC", "PRO", "CLINIC"] as const) {
    const precio = FALLBACK_PLAN_CONFIG[id].priceMxnMonthly;
    const e = esperado[id];
    assert.equal(
      lineaPrimerMesConTarjeta({ promoMxn: FIRST_MONTH_PROMO_MXN[id], precioMensualMxn: precio }),
      `Tu primer mes con tarjeta: ${e.promo} (IVA incluido) · después ${e.mensual} + IVA al mes`,
    );
    for (const metodo of ["spei", "oxxo"] as const) {
      const t = avisoPromoSoloConTarjeta({ promoMxn: FIRST_MONTH_PROMO_MXN[id], totalCompletoCents: desgloseConIva(precio * 100).totalCents, metodo });
      assert.ok(t.includes(`La promoción del primer mes (${e.promo}, IVA incluido) es solo con tarjeta.`), t);
      assert.ok(t.endsWith(`pagas el mes completo: ${e.completo}.`), t);
      assert.ok(t.includes(metodo === "spei" ? "transferencia" : "OXXO"), t);
    }
    assert.equal(botonPagarConTarjetaPromo(FIRST_MONTH_PROMO_MXN[id]), `Pagar con tarjeta por ${e.promo}`);
  }
  assert.equal(lineaDespuesDelPrimerMes({ precioMensualMxn: 419, conIva: false }), "Después $419 al mes");
});

test("el aviso solo sale en compra mensual elegible con SPEI/OXXO; nunca en enlaces, anual ni clínicas que ya pagaron", () => {
  const v = leer("src/components/dashboard/cuenta-rediseno/planes-suspendida.tsx");
  assert.match(v, /const promoPerdida = v\.firstMonthEligible && !anual && !v\.soloTarjeta && v\.method !== "card"/);
  // firstMonthEligible ya excluye el enlace y a quien ya pagó (page.tsx), y la promo sigue siendo solo tarjeta.
  const page = leer("src/app/dashboard/suspended/page.tsx");
  assert.match(page, /firstMonthEligible = isFirstContract\(clinic\) && enlace === null/);
  assert.match(leer("src/app/dashboard/suspended/suspended-client.tsx"), /ctaPromo = firstMonthEligible && billing === "monthly" && method === "card"/);
  // El paso 3 del alta no menciona la promo en el enlace /contratar.
  assert.match(leer("src/components/public/auth/signup/step-3-plan-payment.tsx"), /soloEstePlan \? null : lineaPrimerMesConTarjeta/);
  // Sin cifras escritas a mano en el helper.
  assert.doesNotMatch(leer("src/lib/billing/aviso-promo-tarjeta.ts").replace(/\/\*[\s\S]*?\*\//g, ""), /\$\d/);
});

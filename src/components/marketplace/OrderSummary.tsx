"use client";
/**
 * Esqueleto del OrderSummary — completar en Sprint 3 (cart + checkout).
 * Recibe los totales calculados por calculateTotal() y los muestra en un
 * desglose. Sin botón "Comprar" aún (eso conecta a Stripe en Sprint 3).
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Migrado a CSS vars (--text-1, --text-2, --bg-elev, --border-soft).
 *   - Verde de descuentos usa dark: variant para no saturar en oscuro.
 */
import type { CartTotals, BillingCycle } from "@/lib/marketplace/pricing";
import { useT } from "@/i18n/i18n-provider";

interface OrderSummaryProps {
  totals: CartTotals;
  billingCycle: BillingCycle;
}

const fmt = (mxn: number) => `$${mxn.toLocaleString("es-MX")} MXN`;

export function OrderSummary({ totals, billingCycle }: OrderSummaryProps) {
  const t = useT();
  return (
    <div className="bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-xl p-5">
      <h3 className="font-semibold text-[15px] text-[var(--text-1)] mb-4">{t("pages.orderSummary.title")}</h3>
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-2)]">{t("pages.orderSummary.subtotal")}</dt>
          <dd className="text-[var(--text-1)] font-medium">{fmt(totals.subtotal)}</dd>
        </div>
        {billingCycle === "annual" && totals.annualBonus > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-emerald-700 dark:text-emerald-400">{t("pages.orderSummary.annualBonus")}</dt>
            <dd className="text-emerald-700 dark:text-emerald-400 font-medium">−{fmt(totals.annualBonus)}</dd>
          </div>
        )}
        {totals.discount > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-emerald-700 dark:text-emerald-400">{t("pages.orderSummary.volumeDiscount")}</dt>
            <dd className="text-emerald-700 dark:text-emerald-400 font-medium">−{fmt(totals.discount)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-2)]">{t("pages.orderSummary.vat")}</dt>
          <dd className="text-[var(--text-1)] font-medium">{fmt(totals.tax)}</dd>
        </div>
        <div className="border-t border-[var(--border-soft)] pt-3 mt-3 flex items-center justify-between">
          <dt className="text-[var(--text-1)] font-semibold">
            {billingCycle === "annual"
              ? t("pages.orderSummary.totalAnnual")
              : t("pages.orderSummary.totalMonthly")}
          </dt>
          <dd className="text-[var(--text-1)] font-bold text-lg">{fmt(totals.final)}</dd>
        </div>
      </dl>
    </div>
  );
}

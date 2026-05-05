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

interface OrderSummaryProps {
  totals: CartTotals;
  billingCycle: BillingCycle;
}

const fmt = (mxn: number) => `$${mxn.toLocaleString("es-MX")} MXN`;

export function OrderSummary({ totals, billingCycle }: OrderSummaryProps) {
  return (
    <div className="bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-xl p-5">
      <h3 className="font-semibold text-[15px] text-[var(--text-1)] mb-4">Resumen</h3>
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-2)]">Subtotal</dt>
          <dd className="text-[var(--text-1)] font-medium">{fmt(totals.subtotal)}</dd>
        </div>
        {billingCycle === "annual" && totals.annualBonus > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-emerald-700 dark:text-emerald-400">Bonificación anual (2 meses gratis)</dt>
            <dd className="text-emerald-700 dark:text-emerald-400 font-medium">−{fmt(totals.annualBonus)}</dd>
          </div>
        )}
        {totals.discount > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-emerald-700 dark:text-emerald-400">Descuento por volumen</dt>
            <dd className="text-emerald-700 dark:text-emerald-400 font-medium">−{fmt(totals.discount)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-2)]">IVA 16%</dt>
          <dd className="text-[var(--text-1)] font-medium">{fmt(totals.tax)}</dd>
        </div>
        <div className="border-t border-[var(--border-soft)] pt-3 mt-3 flex items-center justify-between">
          <dt className="text-[var(--text-1)] font-semibold">
            Total {billingCycle === "annual" ? "anual" : "mensual"}
          </dt>
          <dd className="text-[var(--text-1)] font-bold text-lg">{fmt(totals.final)}</dd>
        </div>
      </dl>
    </div>
  );
}

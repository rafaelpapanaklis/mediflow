"use client";
/**
 * Esqueleto del OrderSummary — completar en Sprint 3 (cart + checkout).
 * Recibe los totales calculados por calculateTotal() y los muestra en un
 * desglose. Sin botón "Comprar" aún (eso conecta a Stripe en Sprint 3).
 */
import type { CartTotals, BillingCycle } from "@/lib/marketplace/pricing";

interface OrderSummaryProps {
  totals: CartTotals;
  billingCycle: BillingCycle;
}

const fmt = (mxn: number) => `$${mxn.toLocaleString("es-MX")} MXN`;

export function OrderSummary({ totals, billingCycle }: OrderSummaryProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="font-semibold text-[15px] text-slate-900 mb-4">Resumen</h3>
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">Subtotal</dt>
          <dd className="text-slate-900 font-medium">{fmt(totals.subtotal)}</dd>
        </div>
        {billingCycle === "annual" && totals.annualBonus > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-emerald-700">Bonificación anual (2 meses gratis)</dt>
            <dd className="text-emerald-700 font-medium">−{fmt(totals.annualBonus)}</dd>
          </div>
        )}
        {totals.discount > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-emerald-700">Descuento por volumen</dt>
            <dd className="text-emerald-700 font-medium">−{fmt(totals.discount)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">IVA 16%</dt>
          <dd className="text-slate-900 font-medium">{fmt(totals.tax)}</dd>
        </div>
        <div className="border-t border-slate-100 pt-3 mt-3 flex items-center justify-between">
          <dt className="text-slate-900 font-semibold">
            Total {billingCycle === "annual" ? "anual" : "mensual"}
          </dt>
          <dd className="text-slate-900 font-bold text-lg">{fmt(totals.final)}</dd>
        </div>
      </dl>
    </div>
  );
}

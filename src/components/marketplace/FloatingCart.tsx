"use client";
/**
 * Mini-cart flotante en la esquina inferior derecha. Solo aparece cuando
 * hay items y muestra total + tier alcanzado. En Sprint 3 conecta con
 * /dashboard/marketplace/cart.
 */
import { ChevronRight, ShoppingCart } from "lucide-react";
import { calculateTotal, getDiscountTier, type BillingCycle } from "@/lib/marketplace/pricing";

interface FloatingCartProps {
  prices: number[];
  billingCycle: BillingCycle;
  onClick: () => void;
}

export function FloatingCart({ prices, billingCycle, onClick }: FloatingCartProps) {
  if (prices.length === 0) return null;

  const totals = calculateTotal(prices, billingCycle);
  const tier   = getDiscountTier(prices.length);

  return (
    <div className="fixed bottom-6 right-6 z-30">
      <button
        type="button"
        onClick={onClick}
        className="bg-slate-900 hover:bg-slate-800 text-white rounded-2xl shadow-2xl shadow-slate-900/20 px-5 py-4 flex items-center gap-4 transition-all hover:scale-105"
      >
        <div className="relative">
          <ShoppingCart className="w-5 h-5" strokeWidth={2} aria-hidden />
          <span className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {prices.length}
          </span>
        </div>
        <div className="text-left">
          <div className="text-xs text-slate-400">
            {tier
              ? `${tier.discount}% descuento aplicado`
              : `${prices.length} módulo${prices.length > 1 ? "s" : ""}`}
          </div>
          <div className="text-sm font-semibold">
            ${totals.final.toLocaleString("es-MX")} MXN/{billingCycle === "annual" ? "año" : "mes"}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />
      </button>
    </div>
  );
}

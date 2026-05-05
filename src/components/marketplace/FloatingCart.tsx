"use client";
/**
 * Mini-cart flotante en la esquina inferior derecha. Solo aparece cuando
 * hay items y muestra total + tier alcanzado. En Sprint 3 conecta con
 * /dashboard/marketplace/cart.
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Botón se invierte en dark (slate-100 con texto oscuro) para destacar
 *     sobre fondo dark global del dashboard.
 *   - Badge de count anima con keyframe `mp-cart-pop` cuando cambia el
 *     count (key={prices.length} re-monta el span y dispara animación).
 *   - aria-label descriptivo del estado del carrito.
 *   - Focus-visible ring para keyboard nav.
 *
 * Requiere en globals.css:
 *   @keyframes mp-cart-pop {
 *     0%   { transform: scale(0.6); }
 *     60%  { transform: scale(1.3); }
 *     100% { transform: scale(1); }
 *   }
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
        aria-label={`Ver carrito · ${prices.length} módulo${prices.length > 1 ? "s" : ""} · $${totals.final.toLocaleString("es-MX")} MXN`}
        className="bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-2xl shadow-2xl shadow-slate-900/20 dark:shadow-black/40 ring-1 ring-white/5 dark:ring-slate-900/10 px-5 py-4 flex items-center gap-4 transition-all duration-200 hover:scale-[1.03] active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elev)]"
      >
        <div className="relative">
          <ShoppingCart className="w-5 h-5" strokeWidth={2} aria-hidden />
          <span
            key={prices.length}
            className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center motion-safe:animate-[mp-cart-pop_300ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
          >
            {prices.length}
          </span>
        </div>
        <div className="text-left">
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {tier
              ? `${tier.discount}% descuento aplicado`
              : `${prices.length} módulo${prices.length > 1 ? "s" : ""}`}
          </div>
          <div className="text-sm font-semibold">
            ${totals.final.toLocaleString("es-MX")} MXN/{billingCycle === "annual" ? "año" : "mes"}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500" aria-hidden />
      </button>
    </div>
  );
}

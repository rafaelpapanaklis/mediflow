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
import { useT } from "@/i18n/i18n-provider";

interface FloatingCartProps {
  prices: number[];
  billingCycle: BillingCycle;
  onClick: () => void;
}

export function FloatingCart({ prices, billingCycle, onClick }: FloatingCartProps) {
  const t = useT();
  if (prices.length === 0) return null;

  const totals = calculateTotal(prices, billingCycle);
  const tier   = getDiscountTier(prices.length);

  return (
    <div className="fixed bottom-6 right-6 z-30">
      <button
        type="button"
        onClick={onClick}
        aria-label={t("pages.floatingCart.ariaLabel", { count: prices.length, total: totals.final.toLocaleString("es-MX") })}
        className="text-white rounded-[var(--radius-lg)] shadow-[var(--shadow-3)] px-5 py-4 flex items-center gap-4 transition-transform duration-150 ease-[cubic-bezier(.2,.8,.4,1)] hover:scale-[1.03] active:scale-[.98] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)]"
        style={{ background: "var(--brand-grad)" }}
      >
        <div className="relative">
          <ShoppingCart className="w-5 h-5" strokeWidth={1.75} aria-hidden />
          <span
            key={prices.length}
            className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 bg-white text-[var(--brand)] text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums motion-safe:animate-[mp-cart-pop_300ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
          >
            {prices.length}
          </span>
        </div>
        <div className="text-left">
          <div className="text-[11px] font-medium uppercase tracking-wide text-white">
            {tier
              ? t("pages.floatingCart.discountApplied", { discount: tier.discount })
              : t("pages.floatingCart.modulesCount", { count: prices.length })}
          </div>
          <div className="text-sm font-bold tabular-nums">
            ${totals.final.toLocaleString("es-MX")} MXN/{billingCycle === "annual" ? t("pages.floatingCart.year") : t("pages.floatingCart.month")}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/80" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

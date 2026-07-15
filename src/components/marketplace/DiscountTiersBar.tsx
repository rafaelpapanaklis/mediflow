"use client";
/**
 * Barra de progreso de descuentos por volumen — visual del tier alcanzado
 * y cuánto falta para el siguiente. La lógica del tier viene de pricing.ts.
 *
 * Polish dark-mode (post-Sprint 2):
 *   - El gradient slate-900 ya funcionaba en ambos modos; solo se ajusta
 *     ligeramente más oscuro en dark para no chocar con el fondo.
 *   - Ring sutil para diferenciar del fondo en dark mode global.
 *   - Tier markers usan slate-950 en dark (más oscuro que el fondo de la
 *     barra) para mantener contraste de "no alcanzado" vs "alcanzado".
 *   - role="status" + aria-live para anunciar tier desbloqueado a SR.
 */
import { Check, Gift, Info } from "lucide-react";
import { getDiscountTier } from "@/lib/marketplace/pricing";
import { useT } from "@/i18n/i18n-provider";

interface DiscountTiersBarProps {
  cartCount: number;
}

const TIERS = [
  { count: 3,  discount: 10, label: "3 módulos" },
  { count: 5,  discount: 15, label: "5 módulos" },
  { count: 10, discount: 25, label: "10 módulos" },
];

export function DiscountTiersBar({ cartCount }: DiscountTiersBarProps) {
  const t = useT();
  const currentTier = getDiscountTier(cartCount);
  const nextTier    = TIERS.find((tier) => cartCount < tier.count);
  const progress    = nextTier ? (cartCount / nextTier.count) * 100 : 100;

  return (
    <div className="mb-7 relative overflow-hidden rounded-[var(--radius-lg)] p-6 bg-[var(--brand-soft)] border border-[var(--border-brand)] shadow-[var(--shadow-1)]">
      <div className="relative">
        <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-[var(--radius)] flex items-center justify-center flex-shrink-0 text-white shadow-[0_3px_8px_rgba(124,58,237,.30)]"
              style={{ background: "var(--brand-grad)" }}
              aria-hidden
            >
              <Gift className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-[var(--text-1)]">{t("pages.discountTiers.title")}</h2>
              <p className="text-[13px] text-[var(--text-3)] mt-0.5">
                {t("pages.discountTiers.subtitle")}
              </p>
            </div>
          </div>
          {currentTier && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[var(--radius-sm)] px-3 py-2 flex items-center gap-2 flex-shrink-0 bg-[var(--success-soft)] text-[var(--success-strong)]"
            >
              <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden />
              <span className="text-[13px] font-semibold">{t("pages.discountTiers.activeDiscount", { discount: currentTier.discount })}</span>
            </div>
          )}
        </div>

        <div className="relative mb-3 px-2">
          <div className="h-2 rounded-full overflow-hidden bg-[var(--bg-elev-2)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%`, background: "var(--brand-grad)" }}
            />
          </div>

          <div className="absolute inset-0 flex items-center">
            {TIERS.map((tier) => {
              const reached = cartCount >= tier.count;
              return (
                <div
                  key={tier.count}
                  className="absolute"
                  style={{ left: `calc(${(tier.count / 10) * 100}% - 8px)`, top: 0 }}
                >
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                      reached
                        ? "border-transparent text-white"
                        : "bg-[var(--bg-elev)] border-[var(--border-strong)]"
                    }`}
                    style={reached ? { background: "var(--brand-grad)" } : undefined}
                  >
                    {reached && <Check className="w-2.5 h-2.5" strokeWidth={3} aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 mt-5 gap-4">
          {TIERS.map((tier) => {
            const reached = cartCount >= tier.count;
            return (
              <div
                key={tier.count}
                className={`text-center p-3 rounded-[var(--radius)] transition-all ${reached ? "bg-[var(--bg-elev)] shadow-[var(--shadow-1)]" : ""}`}
              >
                <div className={`text-3xl font-bold tracking-tight tabular-nums ${reached ? "text-[var(--brand)]" : "text-[var(--text-4)]"}`}>
                  {tier.discount}%
                </div>
                <div className={`text-xs mt-1 ${reached ? "text-[var(--text-2)]" : "text-[var(--text-3)]"}`}>
                  {t("pages.discountTiers.modulesCount", { count: tier.count })}
                </div>
              </div>
            );
          })}
        </div>

        {nextTier && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 pt-4 border-t border-[var(--border-brand)] flex items-center gap-2 text-[13px]"
          >
            <Info className="w-4 h-4 flex-shrink-0 text-[var(--info)]" strokeWidth={1.75} aria-hidden />
            <span className="text-[var(--text-2)]">
              {t("pages.discountTiers.addPrefix")}{" "}
              <strong className="text-[var(--text-1)] font-semibold">
                {t("pages.discountTiers.modulesMore", { count: nextTier.count - cartCount })}
              </strong>{" "}
              {t("pages.discountTiers.toUnlock")}{" "}
              <strong className="text-[var(--text-1)] font-semibold">{t("pages.discountTiers.percentDiscount", { discount: nextTier.discount })}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

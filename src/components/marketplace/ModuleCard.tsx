"use client";
/**
 * Card de un módulo en el grid del marketplace. Recibe el estado precomputado
 * desde MarketplaceContent (purchased | trial | available | locked) — no
 * decide nada por sí sola, solo renderiza.
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Migrado a CSS vars existentes (--text-1, --bg-elev, --border-soft, ...)
 *     para auto-soporte light/dark.
 *   - Badges de estado y categoría usan bg con alpha para responder a ambos
 *     modos sin clases dark: explícitas en cada uno.
 *   - Botón primary invierte (bg=text-1, text=bg-elev) — patrón shadcn.
 *   - Focus-visible rings en cada interactivo.
 *   - active:scale-[0.97] microinteracción en click.
 */
import { Check, Lock, Plus } from "lucide-react";
import type { Module } from "@prisma/client";
import { getModuleIcon } from "@/lib/marketplace/icons";
import { useT } from "@/i18n/i18n-provider";

export type ModuleStatus = "purchased" | "trial" | "available" | "locked";

interface ModuleCardProps {
  module: Module;
  inCart: boolean;
  status: ModuleStatus;
  /** Indica que la mutación al carrito está pendiente — para deshabilitar botón. */
  pending?: boolean;
  onAddToCart: () => void;
  onRemoveFromCart: () => void;
}

// La categoría se muestra como tag neutral tokenizado; el color de identidad
// de cada módulo lo aporta el icono (iconBg/iconColor de la BD, ver render).

interface BadgeStyle {
  classes: string;
  dot: string;
  // Llave de traducción para la etiqueta visible; se resuelve con t() en render.
  labelKey: string;
}

const STATUS_BADGE: Record<ModuleStatus, BadgeStyle | null> = {
  purchased: {
    classes: "bg-[var(--info-soft)] text-[var(--info-strong)]",
    dot:     "bg-[var(--info)]",
    labelKey: "pages.moduleCard.badgePurchased",
  },
  trial: {
    classes: "bg-[var(--brand-soft)] text-[var(--brand)]",
    dot:     "bg-[var(--brand)]",
    labelKey: "pages.moduleCard.badgeTrial",
  },
  available: {
    classes: "bg-[var(--success-soft)] text-[var(--success-strong)]",
    dot:     "bg-[var(--success)]",
    labelKey: "pages.moduleCard.badgeAvailable",
  },
  locked: null, // muestra candado en lugar de badge
};

export function ModuleCard({
  module: m,
  inCart,
  status,
  pending = false,
  onAddToCart,
  onRemoveFromCart,
}: ModuleCardProps) {
  const t = useT();
  const Icon = getModuleIcon(m.iconKey);
  const isPurchased = status === "purchased";
  const isLocked    = status === "locked";
  const badge       = STATUS_BADGE[status];

  return (
    <div
      className={`bg-[var(--bg-elev)] border rounded-[var(--radius-lg)] p-5 flex flex-col relative transition-[box-shadow,border-color] duration-150 ease-[cubic-bezier(.2,.8,.4,1)] ${
        inCart
          ? "border-[var(--brand)] shadow-[var(--shadow-2)] ring-1 ring-[var(--brand-soft)]"
          : "border-[var(--border-soft)] shadow-[var(--shadow-1)] hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-2)]"
      } ${isLocked ? "opacity-75" : ""}`}
    >
      {isLocked && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[var(--danger-soft)] flex items-center justify-center">
          <Lock className="w-4 h-4 text-[var(--danger)]" strokeWidth={1.75} aria-hidden />
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center ${isLocked ? "grayscale opacity-60" : ""}`}>
          <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} aria-hidden />
        </div>
        {badge && (
          <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.classes}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} aria-hidden />
            {t(badge.labelKey)}
          </div>
        )}
      </div>

      <div className="mb-2">
        <h3 className={`font-semibold text-[15px] leading-snug ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-1)]"}`}>
          {m.name}
        </h3>
        <span className="inline-flex items-center mt-1.5 text-[10.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--bg-elev-2)] text-[var(--text-3)]">
          {m.category}
        </span>
      </div>

      <p className={`text-sm leading-relaxed mb-3 ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-2)]"}`}>
        {m.description}
      </p>

      <ul className="space-y-2 mb-4 flex-1">
        {m.features.map((f, i) => (
          <li key={i} className={`flex items-start gap-2 text-[13px] ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-2)]"}`}>
            <Check className={`w-4 h-4 mt-px flex-shrink-0 ${isLocked ? "text-[var(--text-3)]" : "text-[var(--success)]"}`} strokeWidth={1.75} aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="pt-4 border-t border-[var(--border-soft)]">
        <div className="flex items-baseline gap-1 mb-3">
          <span className={`text-[22px] font-bold tabular-nums leading-none ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-1)]"}`}>
            ${m.priceMxnMonthly}
          </span>
          <span className="text-xs text-[var(--text-3)]">{t("pages.moduleCard.perMonth")}</span>
        </div>

        {isPurchased ? (
          <div
            role="status"
            aria-live="polite"
            className="w-full text-[13px] font-semibold px-3 py-2.5 rounded-[var(--radius)] bg-[var(--info-soft)] text-[var(--info-strong)] flex items-center justify-center gap-2 cursor-not-allowed"
          >
            <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            {t("pages.moduleCard.alreadyPurchased")}
          </div>
        ) : inCart ? (
          <button
            type="button"
            onClick={onRemoveFromCart}
            disabled={pending}
            aria-label={t("pages.moduleCard.removeAria", { name: m.name })}
            className="w-full text-[13px] font-semibold px-3 py-2.5 rounded-[var(--radius)] bg-[var(--brand-soft)] text-[var(--brand)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(.2,.8,.4,1)] active:scale-[.98] flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-wait focus-visible:outline-none focus-visible:[box-shadow:var(--ring)]"
          >
            <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            {t("pages.moduleCard.inCart")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddToCart}
            disabled={pending}
            aria-label={isLocked ? t("pages.moduleCard.buyToUnlockAria", { name: m.name }) : t("pages.moduleCard.addAria", { name: m.name })}
            className="w-full text-[13px] font-semibold px-3 py-2.5 rounded-[var(--radius)] bg-brand-600 text-white hover:bg-brand-700 transition-[background-color,transform] duration-150 ease-[cubic-bezier(.2,.8,.4,1)] active:scale-[.98] flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-wait focus-visible:outline-none focus-visible:[box-shadow:var(--ring)]"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            {isLocked ? t("pages.moduleCard.buyToUnlock") : t("pages.moduleCard.addToCart")}
          </button>
        )}
      </div>
    </div>
  );
}

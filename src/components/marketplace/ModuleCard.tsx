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

// Categorías con bg en alpha (10% opacidad) — funcionan idénticos en ambos
// modos porque el alpha toma del fondo subyacente. El text-* mantiene
// contraste tanto sobre claro (saturado oscuro) como sobre oscuro (claro).
const CATEGORY_BADGE: Record<string, string> = {
  Dental:       "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Pediatría:    "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  Cardiología:  "bg-red-500/10 text-red-700 dark:text-red-300",
  Dermatología: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  Ginecología:  "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  Nutrición:    "bg-green-500/10 text-green-700 dark:text-green-300",
  Estética:     "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
};

interface BadgeStyle {
  classes: string;
  dot: string;
  label: string;
}

const STATUS_BADGE: Record<ModuleStatus, BadgeStyle | null> = {
  purchased: {
    classes: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-500/20",
    dot:     "bg-blue-500",
    label:   "Comprado",
  },
  trial: {
    classes: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/20",
    dot:     "bg-violet-500",
    label:   "Trial activo",
  },
  available: {
    classes: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
    dot:     "bg-emerald-500",
    label:   "Disponible",
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
  const Icon = getModuleIcon(m.iconKey);
  const isPurchased = status === "purchased";
  const isLocked    = status === "locked";
  const badge       = STATUS_BADGE[status];

  return (
    <div
      className={`bg-[var(--bg-elev)] border rounded-xl p-5 transition-all flex flex-col relative ${
        inCart
          ? "border-blue-500/60 ring-2 ring-blue-500/15 shadow-md dark:shadow-none"
          : "border-[var(--border-soft)] hover:border-[var(--border-strong)] hover:shadow-md dark:hover:shadow-none dark:hover:bg-[var(--bg-hover)]"
      } ${isLocked ? "opacity-75" : ""}`}
    >
      {isLocked && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-red-500/10 ring-1 ring-inset ring-red-500/20 flex items-center justify-center">
          <Lock className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center ${isLocked ? "grayscale opacity-60" : ""}`}>
          <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} aria-hidden />
        </div>
        {badge && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${badge.classes}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} aria-hidden />
            {badge.label}
          </div>
        )}
      </div>

      <div className="mb-2">
        <h3 className={`font-semibold text-[15px] ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-1)]"}`}>
          {m.name}
        </h3>
        <span className={`inline-block mt-1.5 text-[11px] px-1.5 py-0.5 rounded ${CATEGORY_BADGE[m.category] ?? "bg-[var(--bg-hover)] text-[var(--text-2)]"}`}>
          {m.category}
        </span>
      </div>

      <p className={`text-sm leading-relaxed mb-3 ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-2)]"}`}>
        {m.description}
      </p>

      <ul className="space-y-1.5 mb-4 flex-1">
        {m.features.map((f, i) => (
          <li key={i} className={`flex items-start gap-2 text-xs ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-2)]"}`}>
            <Check className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isLocked ? "text-[var(--text-3)]" : "text-emerald-500"}`} strokeWidth={2.5} aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="pt-3 border-t border-[var(--border-soft)]">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <span className={`text-lg font-semibold ${isLocked ? "text-[var(--text-3)]" : "text-[var(--text-1)]"}`}>
              ${m.priceMxnMonthly}
            </span>
            <span className="text-xs text-[var(--text-3)] ml-1">MXN/mes</span>
          </div>
        </div>

        {isPurchased ? (
          <div
            role="status"
            aria-live="polite"
            className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-500/20 flex items-center justify-center gap-2 cursor-not-allowed"
          >
            <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            Ya comprado · Activo en tu cuenta
          </div>
        ) : inCart ? (
          <button
            type="button"
            onClick={onRemoveFromCart}
            disabled={pending}
            aria-label={`Quitar ${m.name} del carrito`}
            className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-500/20 hover:bg-blue-500/15 transition-all duration-150 active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            En el carrito
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddToCart}
            disabled={pending}
            aria-label={isLocked ? `Comprar ${m.name} para desbloquear` : `Agregar ${m.name} al carrito`}
            className={`w-full text-sm font-medium px-3 py-2 rounded-md transition-all duration-150 active:scale-[0.97] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elev)] ${
              isLocked
                ? "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/50"
                : "bg-[var(--text-1)] text-[var(--bg-elev)] hover:opacity-90 focus-visible:ring-[var(--brand)]"
            }`}
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            {isLocked ? "Comprar para desbloquear" : "Agregar al carrito"}
          </button>
        )}
      </div>
    </div>
  );
}

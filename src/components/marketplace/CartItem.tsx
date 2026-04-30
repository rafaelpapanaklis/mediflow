"use client";
/**
 * Esqueleto del CartItem — completar en Sprint 3 (página del carrito).
 * Por ahora exporta un componente que solo muestra el módulo en una fila
 * con botón eliminar. La página /dashboard/marketplace/cart todavía no
 * existe; este componente queda listo para Sprint 3.
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Migrado a CSS vars (--text-1, --text-3, --bg-elev, --border-soft).
 *   - Hover del botón eliminar usa bg-red-500/10 (alpha) que funciona en
 *     ambos modos sin necesitar dark: explícito.
 *   - Focus ring en el botón eliminar.
 */
import { Trash2 } from "lucide-react";
import type { Module } from "@prisma/client";
import { getModuleIcon } from "@/lib/marketplace/icons";

interface CartItemProps {
  module: Module;
  onRemove: () => void;
}

export function CartItem({ module: m, onRemove }: CartItemProps) {
  const Icon = getModuleIcon(m.iconKey);

  return (
    <div className="flex items-center gap-4 bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-xl p-4">
      <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[14px] text-[var(--text-1)] truncate">{m.name}</div>
        <div className="text-xs text-[var(--text-3)]">{m.category}</div>
      </div>
      <div className="text-sm font-semibold text-[var(--text-1)] flex-shrink-0">
        ${m.priceMxnMonthly} MXN/mes
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Eliminar ${m.name} del carrito`}
        className="p-2 rounded-md text-[var(--text-3)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
      >
        <Trash2 className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
}

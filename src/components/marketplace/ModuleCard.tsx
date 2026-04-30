"use client";
/**
 * Card de un módulo en el grid del marketplace. Recibe el estado precomputado
 * desde MarketplaceContent (purchased | trial | available | locked) — no
 * decide nada por sí sola, solo renderiza.
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

const CATEGORY_BADGE: Record<string, string> = {
  Dental:       "bg-blue-50 text-blue-700",
  Pediatría:    "bg-pink-50 text-pink-700",
  Cardiología:  "bg-red-50 text-red-700",
  Dermatología: "bg-orange-50 text-orange-700",
  Ginecología:  "bg-purple-50 text-purple-700",
  Nutrición:    "bg-green-50 text-green-700",
  Estética:     "bg-fuchsia-50 text-fuchsia-700",
};

interface BadgeStyle {
  bg: string;
  text: string;
  dot: string;
  label: string;
}

const STATUS_BADGE: Record<ModuleStatus, BadgeStyle | null> = {
  purchased: { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500",    label: "Comprado" },
  trial:     { bg: "bg-violet-50",  text: "text-violet-700",  dot: "bg-violet-500",  label: "Trial activo" },
  available: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Disponible" },
  locked:    null, // muestra candado en lugar de badge
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
      className={`bg-white border rounded-xl p-5 transition-all flex flex-col relative ${
        inCart
          ? "border-blue-400 ring-2 ring-blue-100 shadow-md"
          : "border-slate-200 hover:border-slate-300 hover:shadow-md"
      } ${isLocked ? "opacity-75" : ""}`}
    >
      {isLocked && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
          <Lock className="w-3.5 h-3.5 text-red-600" />
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center ${isLocked ? "grayscale opacity-60" : ""}`}>
          <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} aria-hidden />
        </div>
        {badge && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${badge.bg} ${badge.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} aria-hidden />
            {badge.label}
          </div>
        )}
      </div>

      <div className="mb-2">
        <h3 className={`font-semibold text-[15px] ${isLocked ? "text-slate-500" : "text-slate-900"}`}>
          {m.name}
        </h3>
        <span className={`inline-block mt-1.5 text-[11px] px-1.5 py-0.5 rounded ${CATEGORY_BADGE[m.category] ?? "bg-slate-100 text-slate-600"}`}>
          {m.category}
        </span>
      </div>

      <p className={`text-sm leading-relaxed mb-3 ${isLocked ? "text-slate-400" : "text-slate-600"}`}>
        {m.description}
      </p>

      <ul className="space-y-1.5 mb-4 flex-1">
        {m.features.map((f, i) => (
          <li key={i} className={`flex items-start gap-2 text-xs ${isLocked ? "text-slate-400" : "text-slate-600"}`}>
            <Check className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isLocked ? "text-slate-300" : "text-emerald-500"}`} strokeWidth={2.5} aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <span className={`text-lg font-semibold ${isLocked ? "text-slate-500" : "text-slate-900"}`}>
              ${m.priceMxnMonthly}
            </span>
            <span className="text-xs text-slate-500 ml-1">MXN/mes</span>
          </div>
        </div>

        {isPurchased ? (
          <div className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center gap-2 cursor-not-allowed">
            <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            Ya comprado · Activo en tu cuenta
          </div>
        ) : inCart ? (
          <button
            type="button"
            onClick={onRemoveFromCart}
            disabled={pending}
            className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
          >
            <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            En el carrito
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddToCart}
            disabled={pending}
            className={`w-full text-sm font-medium px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-wait ${
              isLocked ? "bg-red-600 text-white hover:bg-red-700" : "bg-slate-900 text-white hover:bg-slate-800"
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

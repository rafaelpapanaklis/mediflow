"use client";
/**
 * Barra de progreso de descuentos por volumen — visual del tier alcanzado
 * y cuánto falta para el siguiente. La lógica del tier viene de pricing.ts.
 */
import { Check, Gift, Info } from "lucide-react";
import { getDiscountTier } from "@/lib/marketplace/pricing";

interface DiscountTiersBarProps {
  cartCount: number;
}

const TIERS = [
  { count: 3,  discount: 10, label: "3 módulos" },
  { count: 5,  discount: 15, label: "5 módulos" },
  { count: 10, discount: 25, label: "10 módulos" },
];

export function DiscountTiersBar({ cartCount }: DiscountTiersBarProps) {
  const currentTier = getDiscountTier(cartCount);
  const nextTier    = TIERS.find((t) => cartCount < t.count);
  const progress    = nextTier ? (cartCount / nextTier.count) * 100 : 100;

  return (
    <div className="mb-7 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-500/20 to-cyan-500/0 rounded-full blur-3xl -mr-20 -mt-20" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-violet-500/15 to-purple-500/0 rounded-full blur-3xl -ml-20 -mb-20" />

      <div className="relative">
        <div className="flex items-start justify-between mb-5 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center flex-shrink-0">
              <Gift className="w-5 h-5 text-amber-300" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Descuentos por paquete</h2>
              <p className="text-sm text-slate-300 mt-0.5">
                Más módulos = más ahorro. Combina las especialidades que tu clínica necesite.
              </p>
            </div>
          </div>
          {currentTier && (
            <div className="bg-emerald-500/20 backdrop-blur border border-emerald-400/30 rounded-lg px-3 py-2 flex items-center gap-2 flex-shrink-0">
              <Check className="w-4 h-4 text-emerald-300" strokeWidth={3} aria-hidden />
              <span className="text-sm font-medium text-emerald-100">{currentTier.discount}% activo</span>
            </div>
          )}
        </div>

        <div className="relative mb-3 px-2">
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>

          <div className="absolute inset-0 flex items-center">
            {TIERS.map((t) => {
              const reached = cartCount >= t.count;
              return (
                <div
                  key={t.count}
                  className="absolute"
                  style={{ left: `calc(${(t.count / 10) * 100}% - 8px)`, top: 0 }}
                >
                  <div className={`w-4 h-4 rounded-full border-2 transition-all ${
                    reached ? "bg-emerald-400 border-emerald-400 shadow-lg shadow-emerald-400/50" : "bg-slate-800 border-white/30"
                  }`}>
                    {reached && <Check className="w-2.5 h-2.5 text-white m-0.5" strokeWidth={4} aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 mt-5 gap-4">
          {TIERS.map((t) => {
            const reached = cartCount >= t.count;
            return (
              <div
                key={t.count}
                className={`text-center p-3 rounded-lg transition-all ${reached ? "bg-white/5" : ""}`}
              >
                <div className={`text-3xl font-bold tracking-tight ${reached ? "text-white" : "text-slate-500"}`}>
                  {t.discount}%
                </div>
                <div className={`text-xs mt-1 ${reached ? "text-slate-200" : "text-slate-500"}`}>
                  {t.label}
                </div>
              </div>
            );
          })}
        </div>

        {nextTier && (
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-sm">
            <Info className="w-4 h-4 text-blue-300 flex-shrink-0" aria-hidden />
            <span className="text-slate-300">
              Agrega{" "}
              <strong className="text-white">
                {nextTier.count - cartCount} módulo{nextTier.count - cartCount > 1 ? "s" : ""} más
              </strong>{" "}
              para desbloquear el{" "}
              <strong className="text-white">{nextTier.discount}% de descuento</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

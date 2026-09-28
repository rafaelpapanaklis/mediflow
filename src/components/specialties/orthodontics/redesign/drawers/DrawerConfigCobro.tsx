"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F9 (catálogo de reglas de descuento
// de la clínica: contado, hermanos, pago puntual…) + F10 (recargo por
// atraso, APAGADO por default — decisión de Rafael). Política de TODA la
// clínica, no de un caso: solo SUPER_ADMIN/ADMIN la cambian
// (`guardarConfigDeCobro` la vuelve a comprobar en el servidor).

import { useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { guardarConfigDeCobro } from "@/app/actions/orthodontics/cobro/guardarConfigDeCobro";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { ConfigDeCobro } from "@/lib/orthodontics/cobro/config-db";
import type { ReglaDescuento, TipoValorRecargo } from "@/lib/orthodontics/cobro/reglas";

export interface DrawerConfigCobroProps {
  config: ConfigDeCobro;
  onClose: () => void;
  onGuardado: () => void;
}

let seq = 0;
function nuevoId(): string { seq += 1; return `regla-nueva-${seq}`; }

export function DrawerConfigCobro(props: DrawerConfigCobroProps) {
  const [reglas, setReglas] = useState<ReglaDescuento[]>(props.config.discountRules);
  const [lateFeeEnabled, setLateFeeEnabled] = useState(props.config.lateFee.activo);
  const [lateFeeType, setLateFeeType] = useState<TipoValorRecargo>(props.config.lateFee.tipo);
  const [lateFeeValue, setLateFeeValue] = useState(props.config.lateFee.valor);
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState(props.config.lateFee.diasDeGracia);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function agregarRegla() {
    setReglas((prev) => [...prev, { id: nuevoId(), etiqueta: "", porcentaje: 0 }]);
  }
  function quitarRegla(id: string) {
    setReglas((prev) => prev.filter((r) => r.id !== id));
  }
  function patchRegla(id: string, patch: Partial<ReglaDescuento>) {
    setReglas((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const limpias = reglas.filter((r) => r.etiqueta.trim().length > 0);
      const r = await guardarConfigDeCobro({
        discountRules: limpias,
        lateFeeEnabled,
        lateFeeType,
        lateFeeValue,
        lateFeeGraceDays,
      });
      if (isFailure(r)) { setError(r.error); return; }
      props.onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-config-cobro-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">F9 / F10 · Política de cobro</div>
            <h3 id="drawer-config-cobro-title" className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              Descuentos y recargo por atraso
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section>
            <h4 className="text-xs font-semibold text-slate-700 mb-2 dark:text-slate-300">F9 · Reglas de descuento</h4>
            <p className="text-[11px] text-slate-500 mb-3 dark:text-slate-400">
              Solo son un catálogo de referencia: quien crea la factura sigue aplicando el % a mano en el descuento de la factura.
            </p>
            <div className="space-y-2">
              {reglas.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <input
                    value={r.etiqueta}
                    onChange={(e) => patchRegla(r.id, { etiqueta: e.target.value })}
                    placeholder="Ej. Contado, Hermanos, Pago puntual"
                    className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  />
                  <div className="relative w-24">
                    <input
                      type="number" min={0} max={100} step={1}
                      value={r.porcentaje}
                      onChange={(e) => patchRegla(r.id, { porcentaje: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                      className="w-full pr-6 px-2 py-1.5 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                  </div>
                  <button type="button" onClick={() => quitarRegla(r.id)} aria-label="Quitar regla" className="text-slate-400 hover:text-rose-600">
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <Btn variant="ghost" size="sm" className="mt-2" icon={<Plus className="w-3.5 h-3.5" aria-hidden />} onClick={agregarRegla}>
              Añadir regla
            </Btn>
          </section>

          <section className="border-t border-slate-100 pt-5 dark:border-slate-800">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={lateFeeEnabled} onChange={(e) => setLateFeeEnabled(e.target.checked)} />
              F10 · Cobrar recargo por atraso
            </label>
            <p className="text-[11px] text-slate-500 mt-1 mb-3 dark:text-slate-400">
              Apagado por default. Nunca se cobra solo: quien cobra ve el monto sugerido y decide si lo suma.
            </p>
            {lateFeeEnabled ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  Tipo
                  <select
                    value={lateFeeType}
                    onChange={(e) => setLateFeeType(e.target.value as TipoValorRecargo)}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  >
                    <option value="PCT">% de la mensualidad</option>
                    <option value="FIJO">Monto fijo</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {lateFeeType === "PCT" ? "Porcentaje" : "Monto (MXN)"}
                  <input
                    type="number" min={0} step={lateFeeType === "PCT" ? 1 : 10}
                    value={lateFeeValue}
                    onChange={(e) => setLateFeeValue(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-600 col-span-2 dark:text-slate-400">
                  Días de gracia tras el vencimiento
                  <input
                    type="number" min={0} step={1}
                    value={lateFeeGraceDays}
                    onChange={(e) => setLateFeeGraceDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  />
                </label>
              </div>
            ) : null}
          </section>

          {error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div>
          ) : null}
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 dark:border-slate-800">
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar política"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}

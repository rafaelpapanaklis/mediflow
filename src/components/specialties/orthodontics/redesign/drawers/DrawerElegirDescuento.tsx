"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F9 por caso. Solo ANOTA qué regla
// (de las que configuró la clínica) se le aplicó a este plan — el % en sí
// ya se puso a mano en el descuento de la factura al crearla. Sirve para
// que la ficha lo enseñe consistente, no para calcular nada.

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { elegirDescuentoDelCaso } from "@/app/actions/orthodontics/cobro/elegirDescuentoDelCaso";
import type { ReglaDescuento } from "@/lib/orthodontics/cobro/reglas";

export interface DrawerElegirDescuentoProps {
  treatmentPlanId: string;
  reglas: ReglaDescuento[];
  actual: { ruleId: string | null };
  onClose: () => void;
  onGuardado: () => void;
}

export function DrawerElegirDescuento(props: DrawerElegirDescuentoProps) {
  const [seleccion, setSeleccion] = useState<string | null>(props.actual.ruleId);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const regla = props.reglas.find((r) => r.id === seleccion) ?? null;
      await elegirDescuentoDelCaso({
        treatmentPlanId: props.treatmentPlanId,
        ruleId: regla?.id ?? null,
        label: regla?.etiqueta ?? null,
        pct: regla?.porcentaje ?? null,
      });
      props.onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[380px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-elegir-descuento-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between dark:border-slate-800">
          <h3 id="drawer-elegir-descuento-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">F9 · Descuento de este caso</h3>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {props.reglas.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">La clínica todavía no configuró reglas de descuento (F9).</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSeleccion(null)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm text-left ${seleccion === null ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20" : "border-slate-200 dark:border-slate-700"}`}
              >
                <span>Sin descuento</span>
                {seleccion === null ? <Check className="w-4 h-4 text-violet-600" aria-hidden /> : null}
              </button>
              {props.reglas.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSeleccion(r.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm text-left ${seleccion === r.id ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20" : "border-slate-200 dark:border-slate-700"}`}
                >
                  <span>{r.etiqueta}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{r.porcentaje}%</span>
                    {seleccion === r.id ? <Check className="w-4 h-4 text-violet-600" aria-hidden /> : null}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 dark:border-slate-800">
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Btn>
        </footer>
      </aside>
    </>
  );
}

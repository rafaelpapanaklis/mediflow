"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F12. Anota fecha y monto; no manda
// recordatorio (eso es W-block/portal, fuera de esta parte) — recepción la
// revisa desde la lista de vencidas al día siguiente.

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { registrarPromesaDePago } from "@/app/actions/orthodontics/cobro/registrarPromesaDePago";
import { isFailure } from "@/app/actions/orthodontics/result";

function mañana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DrawerPromesaDePagoProps {
  treatmentPlanId: string;
  montoSugerido: number;
  onClose: () => void;
  onGuardado: () => void;
}

export function DrawerPromesaDePago(props: DrawerPromesaDePagoProps) {
  const [amount, setAmount] = useState(props.montoSugerido || 0);
  const [promisedDate, setPromisedDate] = useState(mañana());
  const [note, setNote] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await registrarPromesaDePago({ treatmentPlanId: props.treatmentPlanId, amount, promisedDate, note: note.trim() || null });
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
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[400px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-promesa-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between dark:border-slate-800">
          <h3 id="drawer-promesa-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">F12 · Promesa de pago</h3>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Monto
            <input
              type="number" min={0} step="0.01"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Fecha prometida
            <input
              type="date"
              value={promisedDate}
              min={mañana()}
              onChange={(e) => setPromisedDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Nota (opcional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Ej. el papá dijo que paga el viernes en la tarde"
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </label>
          {error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div>
          ) : null}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 dark:border-slate-800">
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={guardar} disabled={guardando || amount <= 0}>
            {guardando ? "Guardando..." : "Registrar promesa"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}

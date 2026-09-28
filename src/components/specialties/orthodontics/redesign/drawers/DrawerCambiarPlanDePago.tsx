"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F7, cambiar el plan a mitad del
// tratamiento. Reusa `FormaDePagoFactura` (el mismo bloque de "Forma de
// pago" del editor de facturas y de Presupuestos — ni el dibujo ni la
// aritmética se reinventan) para editar enganche/mensualidades/frecuencia
// de la factura YA CREADA. Guarda con `guardarCondiciones` de siempre (PUT
// /api/invoices/[id]/condiciones) y deja rastro con `auditarCambioDePlan`
// (ese endpoint no audita — hallazgo F7 del reporte de alcance).
//
// El PRECIO no se edita aquí: los conceptos de una factura ya confirmada
// solo se editan en borrador (regla del propio PATCH /api/invoices/[id]).
// Cambiar el precio a mitad de tratamiento es una factura nueva/ajuste, no
// esto.

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { fmtMoney } from "../atoms/format";
import { FormaDePagoFactura } from "@/components/dashboard/factura-ficha-rediseno/forma-de-pago";
import { guardarCondiciones } from "@/components/dashboard/factura-ficha-rediseno/extras";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { auditarCambioDePlan } from "@/app/actions/orthodontics/cobro/auditarCambioDePlan";

export interface DrawerCambiarPlanDePagoProps {
  treatmentPlanId: string;
  invoiceId: string;
  total: number;
  condicionesActuales: CondicionesPago | null;
  onClose: () => void;
  onGuardado: () => void;
}

export function DrawerCambiarPlanDePago(props: DrawerCambiarPlanDePagoProps) {
  const original = props.condicionesActuales ?? condicionesPorDefecto();
  const [cond, setCond] = useState<CondicionesPago>(original);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinCambios = JSON.stringify(cond) === JSON.stringify(original);

  async function guardar() {
    if (sinCambios || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await guardarCondiciones(props.invoiceId, cond);
      if (!r.ok) { setError(r.error ?? "No se pudo guardar el nuevo plan"); return; }
      await auditarCambioDePlan({
        treatmentPlanId: props.treatmentPlanId,
        motivo: motivo.trim() || "Sin motivo anotado",
        antes: original,
        despues: cond,
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
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-cambiar-plan-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-emerald-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-300">F7 · Cambiar el plan</div>
            <h3 id="drawer-cambiar-plan-title" className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              Nuevas condiciones de pago
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Precio total del tratamiento: <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{fmtMoney(props.total)}</span> (no se edita aquí).
          </div>

          <FormaDePagoFactura cond={cond} total={props.total} onChange={setCond} />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">Motivo del cambio (queda en la bitácora)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ej. el paciente pidió alargar el plazo a 30 meses"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </div>

          {error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div>
          ) : null}
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 dark:border-slate-800">
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={guardar} disabled={sinCambios || guardando}>
            {guardando ? "Guardando..." : "Guardar nuevo plan"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}

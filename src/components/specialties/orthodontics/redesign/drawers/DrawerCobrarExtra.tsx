"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F5 (extras aparte del catálogo:
// reposición de bracket, retenedores, microtornillo…) + F11 (reposiciones
// incluidas en el plan). La factura la crea el editor de SIEMPRE
// (`InvoiceEditorModal`, sin tocarlo); este componente es el paso ANTES:
// decir si el concepto que se va a cobrar es una reposición YA incluida en
// el plan (y entonces no se le cobra) o es un extra de verdad.
//
// `esReposicionIncluida` es una GUÍA para quien cobra, no un candado: la
// factura se crea con el precio que esa persona escriba (0 si decide no
// cobrar, o el de catálogo si decide cobrar). Al terminar, `registrarExtraCobrado`
// liga la factura al caso y, si se marcó como incluida, descuenta el cupo.

import { useState } from "react";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { InvoiceEditorModal } from "@/components/billing/invoice-editor-modal";
import { registrarExtraCobrado } from "@/app/actions/orthodontics/cobro/registrarExtraCobrado";

export interface DrawerCobrarExtraProps {
  treatmentPlanId: string;
  patientId: string;
  patientName: string;
  reposicionesRestantes: number;
  onClose: () => void;
  /** Al terminar (con o sin factura creada): refrescar el panel. */
  onListo: () => void;
}

export function DrawerCobrarExtra(props: DrawerCobrarExtraProps) {
  const [esIncluida, setEsIncluida] = useState(false);
  const [abrirEditor, setAbrirEditor] = useState(false);

  if (abrirEditor) {
    return (
      <InvoiceEditorModal
        open
        patientId={props.patientId}
        patientName={props.patientName}
        onClose={props.onClose}
        onCreated={async (invoice: { id: string }) => {
          await registrarExtraCobrado({
            treatmentPlanId: props.treatmentPlanId,
            invoiceId: invoice.id,
            esReposicionIncluida: esIncluida,
          });
          props.onListo();
        }}
      />
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-cobrar-extra-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-amber-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-amber-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium dark:text-amber-300">F5 · Cobrar extra</div>
            <h3 id="drawer-cobrar-extra-title" className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              Reposición, retenedor, microtornillo…
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            Reposiciones incluidas en el plan que quedan: <strong className="font-mono">{props.reposicionesRestantes}</strong>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={esIncluida}
              disabled={props.reposicionesRestantes <= 0}
              onChange={(e) => setEsIncluida(e.target.checked)}
            />
            <span>
              Es una reposición incluida en el plan
              {props.reposicionesRestantes <= 0 ? " (ya no quedan — se cobraría como extra normal)" : ""}
            </span>
          </label>

          {esIncluida ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              <span>Al continuar se abre el editor de factura igual. Pon el concepto con precio $0 si no vas a cobrarlo — este aviso no lo hace por ti.</span>
            </div>
          ) : null}
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 dark:border-slate-800">
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="primary" size="md" icon={<ArrowRight className="w-3.5 h-3.5" aria-hidden />} onClick={() => setAbrirEditor(true)}>
            Continuar a la factura
          </Btn>
        </footer>
      </aside>
    </>
  );
}

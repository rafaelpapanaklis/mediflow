"use client";
// Modal Cobrar siguiente — M1 CFDI 4.0 nativo.
// Stub: Stripe MX/MercadoPago/Conekta + Facturapi requieren credenciales
// (TODO). Por ahora persiste el cobro como manual y marca CFDI UUID
// placeholder para demo.

import { useState } from "react";
import { Calendar, Check, DollarSign, Send, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { fmtMoney } from "../atoms/format";

type Method = "tarjeta" | "transfer" | "efectivo" | "msi";

const METHODS: ReadonlyArray<{ id: Method; label: string; icon: React.ReactNode }> = [
  { id: "tarjeta", label: "Tarjeta", icon: <DollarSign className="w-4 h-4" aria-hidden /> },
  { id: "transfer", label: "Transferencia", icon: <Send className="w-4 h-4" aria-hidden /> },
  { id: "efectivo", label: "Efectivo", icon: <DollarSign className="w-4 h-4" aria-hidden /> },
  { id: "msi", label: "MSI 3-12", icon: <Calendar className="w-4 h-4" aria-hidden /> },
];

export interface ModalCollectProps {
  /** Monto a cobrar en MXN. */
  amount: number;
  /** Etiqueta verbose: "Mensualidad 5/22 · vence 15 may". */
  installmentLabel: string;
  onClose: () => void;
  onConfirm?: (method: Method) => Promise<void> | void;
}

export function ModalCollect(props: ModalCollectProps) {
  const [method, setMethod] = useState<Method>("tarjeta");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await props.onConfirm?.(method);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70"
        onClick={props.onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-collect-title"
      >
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md pointer-events-auto dark:bg-slate-900 dark:border dark:border-slate-800">
          <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between dark:border-slate-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-400">
                Cobro · M1 CFDI 4.0 nativo
              </div>
              <h3
                id="modal-collect-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Cobrar mensualidad
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Cerrar"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>
          <div className="p-6 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center dark:bg-emerald-900/20 dark:border-emerald-800">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-400">
                Monto
              </div>
              <div className="text-3xl font-bold text-emerald-900 font-mono mt-1 dark:text-emerald-300">
                {fmtMoney(props.amount)}
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5 dark:text-emerald-400">
                {props.installmentLabel}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">
                Método de pago
              </div>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded border text-sm transition-colors focus:outline-none ${
                      method === m.id
                        ? "border-emerald-500 bg-emerald-50 text-emerald-900 font-medium dark:bg-emerald-900/20 dark:border-emerald-500 dark:text-emerald-300"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[11px] text-slate-600 flex items-center gap-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
              <Shield
                className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300"
                aria-hidden
              />
              CFDI timbrado automáticamente vía Facturapi al confirmar cobro.
            </div>
            <div className="text-[10px] text-slate-400 italic dark:text-slate-500">
              TODO credenciales Stripe MX / Facturapi requeridas · stub registra el cobro
              como manual y genera UUID placeholder para demo.
            </div>
          </div>
          <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 dark:border-slate-800 dark:bg-slate-900/40">
            <Btn variant="secondary" size="md" onClick={props.onClose}>
              Cancelar
            </Btn>
            <Btn
              variant="emerald"
              size="md"
              icon={<Check className="w-4 h-4" aria-hidden />}
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? "Confirmando…" : "Confirmar cobro"}
            </Btn>
          </footer>
        </div>
      </div>
    </>
  );
}

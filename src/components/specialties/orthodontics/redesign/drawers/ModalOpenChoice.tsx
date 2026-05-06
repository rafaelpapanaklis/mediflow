"use client";
// Modal G5 — Open Choice cotización.
// Presenta 3 escenarios financieros side-by-side. Doctor selecciona uno
// para preparar contrato + Sign@Home (G6).

import { useState } from "react";
import { MessageCircle, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { fmtMoney } from "../atoms/format";
import type { QuoteScenarioDTO } from "../types-finance";

export interface ModalOpenChoiceProps {
  scenarios: QuoteScenarioDTO[];
  patientFirstName?: string;
  /** Confirma escenario seleccionado y dispara Sign@Home G6. */
  onConfirm?: (scenarioId: string) => Promise<void> | void;
  onClose: () => void;
}

export function ModalOpenChoice(props: ModalOpenChoiceProps) {
  const [selected, setSelected] = useState<string>(props.scenarios[1]?.id ?? props.scenarios[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await props.onConfirm?.(selected);
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
        aria-labelledby="modal-openchoice-title"
      >
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-4xl pointer-events-auto max-h-[90vh] flex flex-col dark:bg-slate-900 dark:border-slate-800">
          <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between dark:border-slate-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
                G5 · Open Choice cotización
              </div>
              <h3
                id="modal-openchoice-title"
                className="text-lg font-semibold text-slate-900 dark:text-slate-100"
              >
                Presentar 3 escenarios{props.patientFirstName ? ` a ${props.patientFirstName}` : ""}
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
          <div className="flex-1 overflow-y-auto p-6">
            <div className="text-xs text-slate-500 mb-4 dark:text-slate-400">
              OrthoFi reporta +30% de same-day starts cuando se presentan 3 opciones
              financieras lado a lado en tablet. Selecciona una para preparar contrato y
              pasarela.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {props.scenarios.map((s) => {
                const isSel = selected === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={`text-left rounded-lg p-5 border-2 transition-colors focus:outline-none ${
                      isSel
                        ? "border-violet-500 bg-violet-50/50 ring-4 ring-violet-100 dark:bg-violet-900/20 dark:border-violet-500 dark:ring-violet-900/30"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {s.label}
                      </div>
                      {s.badge ? (
                        <Pill color={isSel ? "violet" : "slate"} size="xs">
                          {s.badge}
                        </Pill>
                      ) : null}
                    </div>
                    <div className="my-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Mensualidad
                      </div>
                      <div className="text-3xl font-bold text-slate-900 font-mono dark:text-slate-100">
                        {s.monthlyAmount > 0 ? fmtMoney(s.monthlyAmount) : "—"}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {s.monthsCount > 0 ? `× ${s.monthsCount} meses` : "pago único"}
                      </div>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <Row k="Enganche" v={fmtMoney(s.downPayment)} />
                      <Row k="Total" v={fmtMoney(s.totalAmount)} />
                      {s.discountPct ? (
                        <Row
                          k="Descuento"
                          v={`-${s.discountPct}%`}
                          vClass="text-emerald-700 dark:text-emerald-400"
                        />
                      ) : null}
                    </div>
                    {s.includes.length > 0 ? (
                      <ul className="mt-3 pt-3 border-t border-slate-200 space-y-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-400">
                        {s.includes.map((inc, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span
                              className="w-1 h-1 rounded-full bg-violet-300 mt-1.5 flex-shrink-0 dark:bg-violet-600"
                              aria-hidden
                            />
                            {inc}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <Shield className="w-3 h-3" aria-hidden />
                      CFDI 4.0 incluido
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-2 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Selección:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {props.scenarios.find((s) => s.id === selected)?.label ?? "—"}
              </span>
            </div>
            <div className="flex gap-2">
              <Btn variant="secondary" size="md" onClick={props.onClose}>
                Cancelar
              </Btn>
              <Btn
                variant="emerald"
                size="md"
                icon={<MessageCircle className="w-4 h-4" aria-hidden />}
                onClick={() => void submit()}
                disabled={!selected || submitting}
              >
                {submitting ? "Confirmando…" : "Enviar Sign@Home WhatsApp · G6"}
              </Btn>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

function Row({ k, v, vClass }: { k: string; v: string; vClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span
        className={`font-mono font-medium ${vClass ?? "text-slate-900 dark:text-slate-100"}`}
      >
        {v}
      </span>
    </div>
  );
}

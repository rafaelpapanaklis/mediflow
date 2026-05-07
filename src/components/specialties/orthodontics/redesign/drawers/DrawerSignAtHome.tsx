"use client";
// Drawer G6 — Sign@Home WhatsApp.
// Stub: el envío real por WhatsApp requiere Twilio API key (TODO).
// Genera un link tokenizado JWT 7-day y muestra preview del paquete
// (contrato + 3 consents + pago + CFDI).

import { Check, DollarSign, FileText, Send, Shield, Sparkles, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

export interface DrawerSignAtHomeProps {
  patientFirstName?: string;
  patientPhone?: string | null;
  /** Token previo si ya se generó. Mostrar la URL preview. */
  existingToken?: string | null;
  /** Resumen del contrato (eg. "Brackets metálicos MBT 0.022 · 22 meses"). */
  contractSummary?: string;
  /** Monto del enganche en MXN. */
  downPaymentAmount?: number;
  onClose: () => void;
  onSend?: () => Promise<void> | void;
}

const DEFAULT_DOWN = 8000;

export function DrawerSignAtHome(props: DrawerSignAtHomeProps) {
  const phone = props.patientPhone ?? "+52 55 1234 5678";
  const tokenPreview = props.existingToken ?? "sgnh_xxxx_yyyyzzzz";
  const downAmount = props.downPaymentAmount ?? DEFAULT_DOWN;
  const summary =
    props.contractSummary ?? "Brackets metálicos MBT 0.022 · 22 meses estimados";

  const steps: Array<{ title: string; sub: string; icon: React.ReactNode }> = [
    {
      title: "1. Contrato de servicios",
      sub: summary,
      icon: <FileText className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden />,
    },
    {
      title: "2. Consentimientos clínicos",
      sub: "Brackets + TADs + asentimiento menor (3 docs)",
      icon: <Shield className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden />,
    },
    {
      title: "3. Pago enganche",
      sub: `$${downAmount.toLocaleString("es-MX")} MXN · Stripe / MercadoPago / Conekta`,
      icon: <DollarSign className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden />,
    },
    {
      title: "4. Factura CFDI 4.0",
      sub: "Timbre automático Facturapi al confirmar pago",
      icon: <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden />,
    },
  ];

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/30 z-40 dark:bg-slate-950/60"
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-signhome-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-emerald-50/40 flex items-center justify-between dark:border-slate-800 dark:bg-emerald-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-400">
              G6 · Sign@Home WhatsApp
            </div>
            <h3
              id="drawer-signhome-title"
              className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
            >
              Liga única firma + cobro
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            Se enviará un link tokenizado por WhatsApp a {phone} que incluye los 4 pasos en
            una sola sesión:
          </div>
          {steps.map((step) => (
            <div
              key={step.title}
              className="border border-slate-200 rounded-lg p-3 flex items-start gap-3 dark:border-slate-700"
            >
              <div
                className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center flex-shrink-0 dark:bg-emerald-900/30"
                aria-hidden
              >
                {step.icon}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {step.title}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                  {step.sub}
                </div>
              </div>
            </div>
          ))}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 dark:bg-slate-800 dark:border-slate-700">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 dark:text-slate-400">
              Token portal paciente · M3
            </div>
            <div className="font-mono text-xs bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-600 truncate dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300">
              /share/p/{tokenPreview}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 dark:text-slate-500">
              Reusa portal tokenizado existente · expira en 72h
            </div>
          </div>
          <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 dark:bg-violet-900/20 dark:border-violet-800">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles
                className="w-3.5 h-3.5 text-violet-700 dark:text-violet-300"
                aria-hidden
              />
              <div className="text-xs font-semibold text-violet-900 dark:text-violet-200">
                Vista previa mensaje
              </div>
            </div>
            <div className="text-xs text-slate-700 leading-relaxed dark:text-slate-300">
              Hola {props.patientFirstName ?? "paciente"}, para iniciar tu tratamiento
              ortodóntico completa estos 4 pasos en este link seguro:{" "}
              <span className="text-violet-700 underline dark:text-violet-300">
                mediflow.app/share/p/{tokenPreview.slice(0, 12)}…
              </span>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 italic dark:text-slate-500">
            TODO Twilio API key requerida para envío real WhatsApp · stub guarda token y
            marca como SENT.
          </div>
        </div>
        <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 dark:border-slate-800 dark:bg-slate-900/40">
          <Btn variant="secondary" size="md" onClick={props.onClose}>
            Cancelar
          </Btn>
          {props.onSend ? (
            <Btn
              variant="emerald"
              size="md"
              icon={<Send className="w-4 h-4" aria-hidden />}
              onClick={() => void props.onSend!()}
            >
              Enviar por WhatsApp
            </Btn>
          ) : null}
        </footer>
      </aside>
    </>
  );
}

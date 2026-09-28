"use client";
// Modal Cobrar siguiente — M1 CFDI 4.0 nativo.
// Stub: Stripe MX/MercadoPago/Conekta + Facturapi requieren credenciales
// (TODO). Por ahora persiste el cobro como manual y marca CFDI UUID
// placeholder para demo.

import { useState } from "react";
import { Calendar, Check, DollarSign, Send, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { fmtMoney } from "../atoms/format";
import orto from "../orto.module.css";

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
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <div
        className={orto.ventanaMarco}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-collect-title"
      >
        <div className="bg-[color:var(--pr-tarjeta)] rounded-[14px] shadow-xl w-full max-w-md pointer-events-auto dark:border">
          <header className={orto.cajonCabeza}>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--pr-exito)] font-medium">
                Cobro · M1 CFDI 4.0 nativo
              </div>
              <h3
                id="modal-collect-title"
                className="text-[15px] font-semibold text-[color:var(--pr-texto)]"
              >
                Cobrar mensualidad
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Cerrar"
              className={orto.botonIcono}
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>
          <div className="p-5 space-y-4">
            <div className="bg-[color:var(--pr-exito-suave)] border border-[color:var(--orto-exito-borde)] rounded-[10px] p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--pr-exito)] font-medium">
                Monto
              </div>
              <div className="text-[26px] font-bold text-[color:var(--pr-exito)] tabular-nums mt-1">
                {fmtMoney(props.amount)}
              </div>
              <div className="text-[11px] text-[color:var(--pr-exito)] mt-0.5">
                {props.installmentLabel}
              </div>
            </div>
            <div>
              <div className={`${orto.ceja} mb-2`}>
                Método de pago
              </div>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-[8px] border text-[13px] transition-colors ${
                      method === m.id
                        ? "border-[color:var(--pr-exito)] bg-[color:var(--pr-exito-suave)] text-[color:var(--pr-exito)] font-medium"
                        : "border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)] hover:border-[color:var(--pr-borde)]"
                    }`}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[color:var(--pr-tarjeta-2)] border border-[color:var(--pr-borde)] rounded-[8px] p-3 text-[11px] text-[color:var(--pr-texto-2)] flex items-center gap-2">
              <Shield
                className="w-3.5 h-3.5 text-[color:var(--orto-violeta)]"
                aria-hidden
              />
              CFDI timbrado automáticamente vía Facturapi al confirmar cobro.
            </div>
            <div className="text-[11px] text-[color:var(--pr-texto-3)] italic">
              TODO credenciales Stripe MX / Facturapi requeridas · stub registra el cobro
              como manual y genera UUID placeholder para demo.
            </div>
          </div>
          <footer className={orto.cajonPie}>
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

"use client";
// Drawer G6 — Sign@Home WhatsApp.
// Stub: el envío real por WhatsApp requiere Twilio API key (TODO).
// Genera un link tokenizado JWT 7-day y muestra preview del paquete
// (contrato + 3 consents + pago + CFDI).

import { Check, DollarSign, FileText, Send, Shield, Sparkles, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const phone = props.patientPhone ?? "+52 55 1234 5678";
  const tokenPreview = props.existingToken ?? "sgnh_xxxx_yyyyzzzz";
  const downAmount = props.downPaymentAmount ?? DEFAULT_DOWN;
  const summary =
    props.contractSummary ?? "Brackets metálicos MBT 0.022 · 22 meses estimados";

  const steps: Array<{ title: string; sub: string; icon: React.ReactNode }> = [
    {
      title: "1. Contrato de servicios",
      sub: summary,
      icon: <FileText className="w-4 h-4 text-[color:var(--pr-exito)]" aria-hidden />,
    },
    {
      title: "2. Consentimientos clínicos",
      sub: "Brackets + TADs + asentimiento menor (3 docs)",
      icon: <Shield className="w-4 h-4 text-[color:var(--pr-exito)]" aria-hidden />,
    },
    {
      title: "3. Pago enganche",
      sub: `$${downAmount.toLocaleString("es-MX")} MXN · Stripe / MercadoPago / Conekta`,
      icon: <DollarSign className="w-4 h-4 text-[color:var(--pr-exito)]" aria-hidden />,
    },
    {
      title: "4. Factura CFDI 4.0",
      sub: "Timbre automático Facturapi al confirmar pago",
      icon: <Check className="w-4 h-4 text-[color:var(--pr-exito)]" aria-hidden />,
    },
  ];

  return (
    <>
      <div
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-signhome-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--pr-exito)] font-medium">
              G6 · Sign@Home WhatsApp
            </div>
            <h3
              id="drawer-signhome-title"
              className={orto.cajonTitulo}
            >
              Liga única firma + cobro
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className={orto.botonIcono}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="text-xs text-[color:var(--pr-texto-2)]">
            Se enviará un link tokenizado por WhatsApp a {phone} que incluye los 4 pasos en
            una sola sesión:
          </div>
          {steps.map((step) => (
            <div
              key={step.title}
              className="border border-[color:var(--pr-borde)] rounded-[10px] p-3 flex items-start gap-3"
            >
              <div
                className="w-9 h-9 rounded-[8px] bg-[color:var(--pr-exito-suave)] flex items-center justify-center flex-shrink-0"
                aria-hidden
              >
                {step.icon}
              </div>
              <div>
                <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
                  {step.title}
                </div>
                <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-0.5">
                  {step.sub}
                </div>
              </div>
            </div>
          ))}
          <div className="bg-[color:var(--pr-tarjeta-2)] border border-[color:var(--pr-borde)] rounded-[10px] p-3">
            <div className={`${orto.ceja} mb-1`}>
              Token portal paciente · M3
            </div>
            {/* Token de portal, se copia-pega tal cual: letra de máquina real
                incluso con Instrument Sans en el resto del panel (WS1-T6). */}
            <div className="mono-tecnico text-xs bg-[color:var(--pr-tarjeta)] border border-[color:var(--pr-borde)] rounded-[8px] px-2 py-1.5 text-[color:var(--pr-texto-2)] truncate">
              /share/p/{tokenPreview}
            </div>
            <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-1">
              Reusa portal tokenizado existente · expira en 72h
            </div>
          </div>
          <div className="bg-[color:var(--pr-activo-suave)] border border-[color:var(--orto-violeta-borde)] rounded-[10px] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles
                className="w-3.5 h-3.5 text-[color:var(--orto-violeta)]"
                aria-hidden
              />
              <div className="text-xs font-semibold text-[color:var(--orto-violeta)]">
                Vista previa mensaje
              </div>
            </div>
            <div className="text-xs text-[color:var(--pr-texto-2)] leading-relaxed">
              Hola {props.patientFirstName ?? "paciente"}, para iniciar tu tratamiento
              ortodóntico completa estos 4 pasos en este link seguro:{" "}
              <span className="text-[color:var(--orto-violeta)] underline">
                dalecontrol.com/share/p/{tokenPreview.slice(0, 12)}…
              </span>
            </div>
          </div>
          <div className="text-[11px] text-[color:var(--pr-texto-3)] italic">
            TODO Twilio API key requerida para envío real WhatsApp · stub guarda token y
            marca como SENT.
          </div>
        </div>
        <footer className={orto.cajonPie}>
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

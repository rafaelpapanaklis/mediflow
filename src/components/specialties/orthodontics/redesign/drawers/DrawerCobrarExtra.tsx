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
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={`${orto.cajon} ${orto.cajonEstrecho}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-cobrar-extra-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Cobrar extra</div>
            <h3 id="drawer-cobrar-extra-title" className={orto.cajonTitulo}>
              Reposición, retenedor, microtornillo…
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-[10px] border border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] p-3 text-xs text-[color:var(--pr-texto-2)]">
            Reposiciones incluidas en el plan que quedan: <strong className="tabular-nums">{props.reposicionesRestantes}</strong>
          </div>

          <label className="flex items-start gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
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
            <div className="flex items-start gap-2 rounded-[10px] border border-[color:var(--orto-alerta-borde)] bg-[color:var(--pr-alerta-suave)] p-3 text-xs text-[color:var(--pr-alerta)]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              <span>Al continuar se abre el editor de factura igual. Pon el concepto con precio $0 si no vas a cobrarlo — este aviso no lo hace por ti.</span>
            </div>
          ) : null}
        </div>

        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="primary" size="md" icon={<ArrowRight className="w-3.5 h-3.5" aria-hidden />} onClick={() => setAbrirEditor(true)}>
            Continuar a la factura
          </Btn>
        </footer>
      </aside>
    </>
  );
}

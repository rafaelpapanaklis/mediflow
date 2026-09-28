"use client";

// Ortodoncia — Ola 0 (ws1-t1): ranura del resumen de cobranza del caso. Se
// monta en dos sitios — la ficha del paciente (junto a SectionFinance, en
// OrthodonticsRedesignClient.tsx) y el panel de la cita (vía RanuraCita, solo
// en citas de control) — para que ambos enseñen EXACTAMENTE el mismo número,
// calculado una sola vez por `cobranzaDelCaso`
// (src/lib/orthodontics/cobranza-caso.ts + cobranza-db.ts).
//
// Rellenada en Ola 1 (ws1-t1 · Cobro): reusa `cargarPanelDeCobro` (la misma
// action que alimenta a SectionFinance) para que la ficha y el panel de la
// cita nunca digan un número distinto. Comparte dueño con «Recepción»
// (R1/R2): esta parte deja el resumen + un botón de cobro rápido; Recepción
// puede sumar aquí su propia lista/aviso sin duplicar la lectura.

import { useEffect, useState } from "react";
import { AlertTriangle, Banknote } from "lucide-react";
import { cargarPanelDeCobro, type PanelDeCobro } from "@/app/actions/orthodontics/cobro/cargarPanelDeCobro";
import { PaymentModal, type PaymentInvoice } from "@/components/dashboard/billing/payment-modal";
import { fmtDay } from "../redesign/atoms/format";
import orto from "../redesign/orto.module.css";

export interface ResumenCobranzaProps {
  treatmentPlanId: string;
  patientName?: string;
}

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function ResumenCobranza(props: ResumenCobranzaProps) {
  const [panel, setPanel] = useState<PanelDeCobro | null | "cargando" | "error">("cargando");
  const [cobrando, setCobrando] = useState(false);

  function recargar() {
    setPanel("cargando");
    cargarPanelDeCobro(props.treatmentPlanId).then((r) => setPanel(r.ok ? r.data : "error")).catch(() => setPanel("error"));
  }

  useEffect(() => { recargar(); }, [props.treatmentPlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (panel === "cargando" || panel === "error") return null;
  if (!panel.invoiceId || !panel.cobranza || !panel.invoice) return null;

  const cuota = panel.cobranza.cuotaDeHoy;
  const vencida = cuota?.estado === "vencida";
  const invoiceComoPago: PaymentInvoice = {
    id: panel.invoice.id,
    invoiceNumber: panel.invoice.invoiceNumber ?? "",
    total: panel.invoice.total,
    paid: panel.invoice.paid,
    balance: panel.invoice.balance,
    status: panel.invoice.status,
    patientName: props.patientName,
  };

  return (
    <div
      className={`${orto.aviso} ${vencida ? orto.avisoPeligro : ""}`}
      style={vencida ? { color: "var(--pr-texto-2)" } : undefined}
      role="status"
    >
      <div className={`${orto.avisoTexto} flex items-start gap-2`}>
        {vencida ? (
          <AlertTriangle size={16} strokeWidth={1.75} className={`${orto.tonoPeligro} shrink-0 mt-[1px]`} aria-hidden />
        ) : null}
        <div className="min-w-0">
          <div className={`text-[13px] font-semibold ${vencida ? orto.tonoPeligro : orto.tonoTexto}`}>
            {cuota
              ? `${vencida ? "Mensualidad vencida" : "Próxima mensualidad"}: ${fmt.format(cuota.falta)}`
              : "Sin mensualidades pendientes"}
          </div>
          <div className="text-xs text-[color:var(--pr-texto-3)]">
            {cuota?.vencimiento ? `${vencida ? "Venció" : "Vence"} el ${fmtDay(cuota.vencimiento)} · ` : ""}
            Saldo total {fmt.format(panel.invoice.balance)}
            {panel.cobranza.saldoAFavor > 0 ? (
              <span className={orto.tonoExito}> · saldo a favor {fmt.format(panel.cobranza.saldoAFavor)}</span>
            ) : null}
          </div>
        </div>
      </div>
      {panel.invoice.balance > 0 ? (
        <button
          type="button"
          onClick={() => setCobrando(true)}
          className={`${orto.boton} ${orto.botonChico} ${vencida ? orto.botonPrincipal : ""}`}
        >
          <Banknote size={14} strokeWidth={1.75} aria-hidden /> Cobrar
        </button>
      ) : null}
      {cobrando ? (
        <PaymentModal
          open
          invoice={invoiceComoPago}
          onClose={() => setCobrando(false)}
          onSuccess={() => { setCobrando(false); recargar(); }}
          rediseno={panel.redisenoFacturas}
        />
      ) : null}
    </div>
  );
}

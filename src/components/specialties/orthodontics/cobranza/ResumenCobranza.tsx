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
      className={`rounded-lg border p-3 text-xs flex items-center justify-between gap-3 flex-wrap ${
        vencida
          ? "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20"
          : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60"
      }`}
      role="status"
    >
      <div className="flex items-center gap-2">
        {vencida ? <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden /> : null}
        <div>
          <span className={vencida ? "text-rose-800 dark:text-rose-200" : "text-slate-700 dark:text-slate-200"}>
            {cuota
              ? `${vencida ? "Vencida" : "Próxima"}: ${fmt.format(cuota.falta)}${cuota.vencimiento ? ` · vence ${cuota.vencimiento}` : ""}`
              : "Sin cuotas pendientes"}
          </span>
          <span className="text-slate-400 dark:text-slate-500"> · saldo total {fmt.format(panel.invoice.balance)}</span>
          {panel.cobranza.saldoAFavor > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400"> · saldo a favor {fmt.format(panel.cobranza.saldoAFavor)}</span>
          ) : null}
        </div>
      </div>
      {panel.invoice.balance > 0 ? (
        <button
          type="button"
          onClick={() => setCobrando(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700"
        >
          <Banknote className="w-3 h-3" aria-hidden /> Cobrar
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

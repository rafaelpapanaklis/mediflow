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
// ws1-t4: «Cobrar» abre la ventana completa de la factura, no la de cobro suelta.
import { CobrarEnFactura } from "@/components/dashboard/billing/cobrar-en-factura";
import { fmtDay } from "../redesign/atoms/format";
import { resumenDeVencidas, tituloDeVencido } from "@/lib/orthodontics/cobro/linea-de-vencido";
import { cobroPrincipalDelCaso } from "@/lib/orthodontics/cobro/cobro-principal";
import { esPlanAPlazos } from "@/lib/invoices/plan-de-pagos";
import orto from "../redesign/orto.module.css";

export interface ResumenCobranzaProps {
  treatmentPlanId: string;
  patientName?: string;
  /**
   * Hallazgo ws1-t4 §11 (ráfaga de ~15 llamadas al abrir la pestaña): desde
   * la ficha del paciente, `OrthodonticsRedesignClient` ya cargó
   * `cargarPanelDeCobro` para `SectionFinance` — se lo pasa aquí para no
   * repetir la misma consulta. Desde `RanuraCita` (panel de la cita en
   * Agenda) no hay ese padre compartido: se omite y esta ranura auto-carga
   * la suya, como siempre.
   */
  panel?: PanelDeCobro | null | "cargando" | "error";
  onReload?: () => void;
}

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function ResumenCobranza(props: ResumenCobranzaProps) {
  const compartido = props.panel !== undefined;
  const [panelPropio, setPanelPropio] = useState<PanelDeCobro | null | "cargando" | "error">("cargando");
  const panel = compartido ? props.panel! : panelPropio;
  const [cobrando, setCobrando] = useState(false);

  function recargarPropio() {
    setPanelPropio("cargando");
    cargarPanelDeCobro(props.treatmentPlanId).then((r) => setPanelPropio(r.ok ? r.data : "error")).catch(() => setPanelPropio("error"));
  }
  const recargar = compartido ? props.onReload ?? (() => {}) : recargarPropio;

  useEffect(() => {
    if (!compartido) recargarPropio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compartido, props.treatmentPlanId]);

  if (panel === "cargando" || panel === "error") return null;
  if (!panel.cobranza || (!panel.invoice && panel.deuda.porCobrar <= 0)) return null;

  // ws1-t4 (revisión final, fallo 11): «mensualidad» solo si la factura del caso
  // es a plazos. La colocación de «Pago por control» y el pago único de «Precio
  // total» no tienen mensualidades: no se habla de ellas.
  const aPlazos = esPlanAPlazos(panel.condiciones);
  const cuota = panel.cobranza.cuotaDeHoy;
  // H8: con cuotas vencidas, el título y el botón hablan de LO MISMO (la suma).
  const vencidas = resumenDeVencidas(panel.cobranza.vencidas);
  const vencida = vencidas.cuantas > 0 || cuota?.estado === "vencida";
  // ws1-t10 (H68): antes este botón abría PaymentModal SIN `montoSugerido`, y
  // el campo nacía en el saldo COMPLETO del tratamiento aunque el aviso de
  // arriba dijera "Próxima mensualidad $1,000". Mismo cálculo que ya usa
  // SectionFinance (`panel.cobranza.vencidas` primero, si no `cuotaDeHoy`).
  // ws1-t4: la MISMA factura y el MISMO monto que «Cobrar» de la Sección F y de la cabecera.
  // (En «Pago por control» con un control que se debe, ese control; si no, lo vencido o la cuota de hoy.)
  const cobro = cobroPrincipalDelCaso(panel);
  const montoSugerido = cobro?.montoSugerido ?? 0;
  // Nunca sobre una factura cancelada (ws1-t10 H·F); y solo si el plan o los controles deben algo.
  const puedeOfrecerCobro = Boolean(cobro) && panel.deuda.delPlan > 0 && !(cobro!.invoiceId === panel.invoice?.id && panel.invoice?.status === "CANCELLED");

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
            {vencidas.cuantas > 0
              ? aPlazos
                ? tituloDeVencido(vencidas, (n) => fmt.format(n))
                : `Vencido: ${fmt.format(vencidas.total)}`
              : cuota
                ? `${aPlazos ? "Próxima mensualidad" : "Por cobrar"}: ${fmt.format(cuota.falta)}`
                : aPlazos
                  ? "Sin mensualidades pendientes"
                  : "Nada pendiente del tratamiento"}
          </div>
          <div className="text-xs text-[color:var(--pr-texto-3)]">
            {vencidas.cuantas > 0 && vencidas.masAntigua
              ? `${vencidas.cuantas > 1 ? "La más antigua venció" : "Venció"} el ${fmtDay(vencidas.masAntigua)} · `
              : cuota?.vencimiento
                ? `${vencida ? "Venció" : "Vence"} el ${fmtDay(cuota.vencimiento)} · `
                : ""}
            {/* Lo que debe el caso: la misma cifra de Cobranza, Casos y la cabecera (deudaDelCaso). */}
            Saldo total {fmt.format(panel.deuda.porCobrar)}
            {panel.deuda.extras > 0 ? ` (incluye ${fmt.format(panel.deuda.extras)} en extras)` : ""}
            {panel.cobranza.saldoAFavor > 0 ? (
              <span className={orto.tonoExito}> · saldo a favor {fmt.format(panel.cobranza.saldoAFavor)}</span>
            ) : null}
          </div>
        </div>
      </div>
      {/* ws1-t4: sin permiso de cobro (billing.charge) no se ofrece «Cobrar». */}
      {panel.puedeCobrar && puedeOfrecerCobro ? (
        <button
          type="button"
          onClick={() => setCobrando(true)}
          className={`${orto.boton} ${orto.botonChico} ${vencida ? orto.botonPrincipal : ""}`}
        >
          <Banknote size={14} strokeWidth={1.75} aria-hidden /> Cobrar
        </button>
      ) : null}
      {cobrando && cobro ? (
        <CobrarEnFactura
          invoiceId={cobro.invoiceId}
          patientName={props.patientName}
          montoSugerido={montoSugerido}
          rediseno={panel.redisenoFacturas}
          clinicTaxMode={panel.clinicTaxMode}
          onClose={() => setCobrando(false)}
          onRefrescar={recargar}
        />
      ) : null}
    </div>
  );
}

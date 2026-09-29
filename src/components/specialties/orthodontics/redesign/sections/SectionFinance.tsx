"use client";
// Sección F — Plan financiero del tratamiento (ws1-t1, Ola 1 · Cobro).
//
// Reescrita de cero: la versión de Ola 0 pintaba una maqueta (installments
// falsos, "CFDI 4.0 Facturapi" que no existe, "Cobrar siguiente" que no
// pasaba por Caja — bloque S3, QUITAR). Esta versión es la decisión 1 de la
// arquitectura: el dinero vive en la factura a plazos del tratamiento
// (`invoice_payment_terms` + `payments`), nunca en OrthoPaymentPlan/
// OrthoInstallment.
//
// Autofetch: se basta con `treatmentPlanId` — llama a `cargarPanelDeCobro`
// al montar y después de cada acción (mismo espíritu que
// `AvisoAnticiposPorRevisar` en Caja). Así OrthodonticsRedesignClient.tsx
// (compartido con las otras 5 partes de la ola) no necesita hilar props
// financieras nuevas.
//
// F1 (precio único) queda resuelto solo: no hay más precio que el de la
// factura del tratamiento. F3/F4 (cobrar mensualidad o abono extra) y F2
// (abrir el plan) reusan el editor de facturas y el modal de cobro de
// SIEMPRE (`InvoiceEditorModal` y, para cobrar, la ventana completa de la
// factura — ws1-t4; antes la de cobro suelta, `PaymentModal`) — nunca se toca
// `src/app/api/invoices/**`. F6 (CFDI de mensualidades) y F13 (cobro
// automático con tarjeta) quedan pendientes de Rafael — ver el hueco abajo.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Download, Percent, Plus, Printer, Settings2, Wallet } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDateShort, fmtDay, fmtMoney } from "../atoms/format";
import { InvoiceEditorModal } from "@/components/billing/invoice-editor-modal";
// ws1-t4: «Cobrar» abre la ventana completa de la factura, no la de cobro suelta.
import { CobrarEnFactura } from "@/components/dashboard/billing/cobrar-en-factura";
import { DrawerCambiarPlanDePago } from "../drawers/DrawerCambiarPlanDePago";
import { ExtrasPorCobrar } from "../../cobranza/ExtrasPorCobrar";
import { DrawerCobrarExtra } from "../drawers/DrawerCobrarExtra";
import { DrawerConfigCobro } from "../drawers/DrawerConfigCobro";
import { DrawerElegirDescuento } from "../drawers/DrawerElegirDescuento";
import { DrawerLigarFactura } from "../drawers/DrawerLigarFactura";
import { DrawerPromesaDePago } from "../drawers/DrawerPromesaDePago";
import { cargarPanelDeCobro, type PanelDeCobro, type FacturaResumen, type ControlPorCobrar } from "@/app/actions/orthodontics/cobro/cargarPanelDeCobro";
import { resolverPromesaDePago } from "@/app/actions/orthodontics/cobro/resolverPromesaDePago";
import { abrirPlanDePago } from "@/app/actions/orthodontics/cobro/abrirPlanDePago";
import { comprobarPlanDePagoLibre } from "@/app/actions/orthodontics/cobro/comprobarPlanDePagoLibre";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { CuotaConEstado } from "@/lib/invoices/plan-de-pagos";
import orto from "../orto.module.css";

export interface SectionFinanceProps {
  treatmentPlanId: string;
  patientId: string;
  patientName?: string;
  /**
   * Hallazgo ws1-t4 §11 (ráfaga de ~15 llamadas al abrir la pestaña):
   * `OrthodonticsRedesignClient` carga `cargarPanelDeCobro` UNA vez y la
   * comparte con `ResumenCobranza` (mismo caso, mismo número, una sola
   * consulta) — si llega, esta sección deja de auto-cargar la suya. Sin
   * esto (p. ej. cualquier otro montaje futuro de esta sección) sigue
   * auto-cargando como siempre: compatible hacia atrás.
   */
  panel?: PanelDeCobro | null | "cargando" | "error";
  onReload?: () => void;
}

type DrawerKind =
  | { kind: "abrir-plan" }
  | { kind: "ligar-factura" }
  | { kind: "cobrar-control"; invoiceId: string }
  | { kind: "cobrar" }
  | { kind: "extra" }
  | { kind: "cambiar-plan" }
  | { kind: "descuento" }
  | { kind: "promesa" }
  | { kind: "config" }
  | null;

function calendarioCompleto(cobranza: NonNullable<PanelDeCobro["cobranza"]>): CuotaConEstado[] {
  return [...cobranza.pagadas, ...cobranza.vencidas, ...cobranza.proximas].sort((a, b) => a.numero - b.numero);
}

/**
 * «Imprimir convenio» (ws1-t4, 29-sep-2026). Antes armaba una ventana
 * about:blank con HTML plano (sin logo, sin clínica, sin doctor, fechas sin
 * año) porque la ruta del PDF solo aceptaba ids del OrthoPaymentPlan viejo.
 * Ahora abre el PDF de verdad —membrete de la clínica, responsable del pago,
 * doctor con cédula, calendario con año y estado, condiciones de la clínica y
 * firmas—, el mismo archivo para imprimir y para descargar.
 */
export function urlDelConvenio(treatmentPlanId: string, descargar = false): string {
  return `/api/orthodontics/payment-plans/${encodeURIComponent(treatmentPlanId)}/financial-agreement-pdf${descargar ? "?descargar=1" : ""}`;
}

const ICONO_SECCION = <Wallet size={15} strokeWidth={1.75} />;
const SUB_SECCION = "Plan de pago, mensualidades y extras";

const ESTILO_CUOTA: Record<CuotaConEstado["estado"], string> = {
  pagada: `${orto.cajaExito} ${orto.tonoExito}`,
  vencida: `${orto.cajaPeligro} ${orto.tonoPeligro}`,
  porVencer: orto.tonoTexto2,
};

export function SectionFinance(props: SectionFinanceProps) {
  const compartido = props.panel !== undefined;
  const [panelPropio, setPanelPropio] = useState<PanelDeCobro | null | "cargando" | "error">("cargando");
  const panel = compartido ? props.panel! : panelPropio;

  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [ligandoHuerfana, setLigandoHuerfana] = useState(false);

  const recargarPropio = useCallback(() => {
    setPanelPropio("cargando");
    cargarPanelDeCobro(props.treatmentPlanId).then((r) => {
      setPanelPropio(r.ok ? r.data : "error");
    }).catch(() => setPanelPropio("error"));
  }, [props.treatmentPlanId]);

  const recargar = compartido ? props.onReload ?? (() => {}) : recargarPropio;

  useEffect(() => {
    if (!compartido) recargarPropio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compartido, recargarPropio]);

  function cerrarYRecargar() {
    setDrawer(null);
    recargar();
  }

  if (panel === "cargando") {
    return (
      <Card id="finance" icon={ICONO_SECCION} title="Cobro del tratamiento" eyebrow={SUB_SECCION}>
        {/* Reserva el alto de los tres totales: al llegar los datos la página no salta. */}
        <div className={`${orto.tarjetaCuerpo} ${orto.vacioLinea}`} style={{ minHeight: 96 }} role="status">
          Cargando la cobranza…
        </div>
      </Card>
    );
  }
  if (panel === "error") {
    return (
      <Card id="finance" icon={ICONO_SECCION} title="Cobro del tratamiento" eyebrow={SUB_SECCION} accent="rose">
        <div className={orto.tarjetaCuerpo}>
          <div className={`${orto.aviso} ${orto.avisoPeligro}`} role="alert">
            <span className={orto.avisoTexto}>No se pudo cargar la cobranza de este caso.</span>
            <Btn variant="secondary" size="sm" onClick={recargar}>
              Reintentar
            </Btn>
          </div>
        </div>
      </Card>
    );
  }

  const esPorControl = panel.billingMode === "PAGO_POR_CONTROL";
  // ws1-t4 #77: en «Pago por control» el «Cobrar» de arriba abría la factura de
  // colocación, casi siempre YA pagada. Ahora abre el primer control que se debe
  // (y cada control tiene su propio «Cobrar» abajo); la colocación solo si aún debe.
  const controlesPorCobrar = esPorControl ? panel.controlesPorCobrar ?? [] : [];
  const facturaACobrar: FacturaResumen | ControlPorCobrar | null =
    esPorControl && controlesPorCobrar.length > 0
      ? controlesPorCobrar[0]
      : panel.invoice && (!esPorControl || panel.invoice.balance > 0.004) ? panel.invoice : null;
  const idFacturaACobrar: string | null = facturaACobrar
    ? ("id" in facturaACobrar ? facturaACobrar.id : facturaACobrar.invoiceId)
    : null;
  const controlACobrar = drawer?.kind === "cobrar-control" ? controlesPorCobrar.find((c) => c.invoiceId === drawer.invoiceId) ?? null : null;
  const hayDeudaDeControles = Boolean(panel.cobranza && (panel.cobranza.vencidas.length > 0 || panel.cobranza.proximas.length > 0));

  // ronda 3 (ws1-t2, H6): lo que se sugiere cobrar con «Cobrar» — TODO lo
  // vencido (si hay), si no la cuota de hoy. Mismo criterio que ya usaba
  // «Registrar promesa de pago» (montoSugerido, abajo): un solo número, no
  // dos que puedan discrepar entre el rótulo del botón y lo que precarga el
  // modal.
  const montoCobrarSugerido = esPorControl && controlesPorCobrar.length > 0
    ? controlesPorCobrar[0].balance
    : panel.cobranza
      ? panel.cobranza.vencidas.reduce((acc, q) => acc + q.falta, 0) || panel.cobranza.cuotaDeHoy?.falta || 0
      : 0;

  // #77: la lista de controles que se deben, uno por uno, cada uno con su «Cobrar».
  const bloqueControlesPorCobrar = controlesPorCobrar.length > 0 ? (
    <div className="px-[18px] py-[14px] border-b border-[color:var(--pr-borde-suave)]" data-controles-por-cobrar>
      <h4 className={`${orto.bloqueTitulo} mb-2`}>Controles por cobrar</h4>
      <ul className="space-y-1.5">
        {controlesPorCobrar.map((c) => (
          <li key={c.invoiceId} className="flex items-center justify-between gap-3 text-[13px]">
            <span>
              {c.invoiceNumber ?? "Control"} · {fmtDay(c.vencimiento)}
              {c.paid > 0 ? <span className="text-[color:var(--pr-texto-3)]"> · abonado {fmtMoney(c.paid)}</span> : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums font-medium">{fmtMoney(c.balance)}</span>
              {panel.puedeCobrar ? (
                <Btn variant="secondary" size="sm" onClick={() => setDrawer({ kind: "cobrar-control", invoiceId: c.invoiceId })}>Cobrar</Btn>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <>
      <Card
        id="finance"
        icon={ICONO_SECCION}
        title="Cobro del tratamiento"
        eyebrow={SUB_SECCION}
        action={
          <div className="flex items-center gap-2">
            <Pill color={esPorControl ? "violet" : "slate"} size="xs">
              {panel.billingModeLabel}
            </Pill>
            {panel.puedeConfigurarPolitica ? (
              <Btn variant="secondary" size="sm" icon={<Settings2 size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "config" })}>
                Política de cobro
              </Btn>
            ) : null}
          </div>
        }
      >
        <div style={{ padding: "0 18px" }}>
          <ExtrasPorCobrar treatmentPlanId={props.treatmentPlanId} />
        </div>
        {!panel.invoiceId ? (
          <div className={orto.tarjetaCuerpo}>
            <div className={orto.vacio}>
              <span className={orto.vacioIcono} aria-hidden>
                <Wallet size={17} strokeWidth={1.75} />
              </span>
              <p className={orto.vacioTitulo}>
                {esPorControl ? "Este caso todavía no tiene la factura de colocación/enganche" : "Este caso todavía no tiene un plan de pago"}
              </p>
              <p className={orto.vacioPista}>
                {esPorControl
                  ? "En «Pago por control» los controles atendidos se cobran aparte, en Caja — esta factura es solo la colocación/enganche del aparato."
                  : panel.redisenoFacturas
                    ? "Abre la factura del tratamiento con su precio, enganche y mensualidades."
                    : "El diseño nuevo de facturación está apagado en esta clínica: solo se puede abrir un pago único (sin mensualidades)."}
              </p>
              {esPorControl && hayDeudaDeControles ? (
                <p className={`${orto.vacioPista} ${orto.tonoPeligro}`}>
                  Ya hay controles con factura sin pagar (saldo {fmtMoney(panel.cobranza!.saldoTotal)}) — cóbralos desde Caja.
                </p>
              ) : null}
              {panel.facturaSinLigar ? (
                <div className={`${orto.aviso} ${orto.avisoAlerta}`} role="status" style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
                  <span className={orto.avisoTexto}>
                    Encontramos la factura <strong>{panel.facturaSinLigar.invoiceNumber}</strong> ({panel.facturaSinLigar.concepto} · {fmtMoney(panel.facturaSinLigar.total)}),
                    creada {fmtDateShort(panel.facturaSinLigar.fecha)}, que no quedó ligada a este caso. ¿Es el plan de pago?
                  </span>
                  <Btn
                    variant="primary"
                    size="sm"
                    disabled={ligandoHuerfana}
                    onClick={async () => {
                      setLigandoHuerfana(true);
                      const r = await abrirPlanDePago({ treatmentPlanId: props.treatmentPlanId, invoiceId: panel.facturaSinLigar!.id, origen: "ligar" });
                      setLigandoHuerfana(false);
                      if (isFailure(r)) window.alert(r.error);
                      recargar();
                    }}
                  >
                    {ligandoHuerfana ? "Ligando…" : "Ligarla al caso"}
                  </Btn>
                </div>
              ) : null}
              <Btn variant="primary" className="mt-1" icon={<Plus size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "abrir-plan" })}>
                {esPorControl ? "Abrir factura de colocación/enganche" : "Abrir plan de pago"}
              </Btn>
              {/* ws1-t4 #75: si la factura del tratamiento ya existe (presupuesto
                  aceptado, o hecha en Facturación), se LIGA en vez de crear otra. */}
              <Btn variant="ghost" size="sm" onClick={() => setDrawer({ kind: "ligar-factura" })}>
                Ya tengo la factura: ligarla al caso
              </Btn>
              {bloqueControlesPorCobrar}
            </div>
          </div>
        ) : (
          <>
            <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
              <div className={orto.rejilla3} style={{ gap: "12px 18px" }}>
                <div className={orto.dato}>
                  <div className={orto.datoEtiqueta}>Total del tratamiento</div>
                  <div className={`${orto.datoValor} ${orto.datoValorGrande}`}>{fmtMoney(panel.invoice!.total)}</div>
                </div>
                <div className={orto.dato}>
                  <div className={orto.datoEtiqueta}>Pagado</div>
                  <div className={`${orto.datoValor} ${orto.datoValorGrande} ${orto.tonoExito}`}>{fmtMoney(panel.invoice!.paid)}</div>
                </div>
                <div className={orto.dato}>
                  <div className={orto.datoEtiqueta}>Por cobrar</div>
                  <div className={`${orto.datoValor} ${orto.datoValorGrande} ${(panel.cobranza?.vencidas.length ?? 0) > 0 ? orto.tonoPeligro : ""}`}>{fmtMoney(panel.invoice!.balance)}</div>
                  {panel.cobranza?.saldoAFavor ? (
                    <div className={`${orto.datoSub} ${orto.tonoExito}`}>Saldo a favor: {fmtMoney(panel.cobranza.saldoAFavor)}</div>
                  ) : null}
                </div>
              </div>
              <ProgressBar value={panel.invoice!.paid} max={panel.invoice!.total} color="emerald" className="mt-[12px]" ariaLabel="Avance de pagos" />
            </div>

            {panel.cobranza ? (
              <div className="px-[18px] py-[14px] border-b border-[color:var(--pr-borde-suave)] flex flex-wrap items-center gap-2">
                {/* ws1-t4: sin permiso de cobro (billing.charge) no se ofrece «Cobrar». */}
                {panel.puedeCobrar ? (
                <Btn variant="primary" size="md" icon={<Banknote size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "cobrar" })}>
                  Cobrar {montoCobrarSugerido > 0 ? `· ${fmtMoney(montoCobrarSugerido)}` : ""}
                </Btn>
                ) : null}
                <Btn variant="secondary" size="md" icon={<Plus size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "extra" })}>
                  Cobrar extra
                </Btn>
                <Btn variant="ghost" size="md" icon={<CalendarClock size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "cambiar-plan" })}>
                  Cambiar plan de pago
                </Btn>
                <Btn variant="ghost" size="md" icon={<Percent size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "descuento" })}>
                  Descuento
                </Btn>
                {panel.cobranza.vencidas.length > 0 ? (
                  <Btn variant="ghost" size="md" onClick={() => setDrawer({ kind: "promesa" })}>
                    Registrar promesa de pago
                  </Btn>
                ) : null}
                <Btn
                  variant="ghost"
                  size="md"
                  icon={<Printer size={15} strokeWidth={1.75} aria-hidden />}
                  onClick={() => window.open(urlDelConvenio(props.treatmentPlanId), "_blank", "noopener")}
                >
                  Imprimir convenio
                </Btn>
                <Btn
                  variant="ghost"
                  size="md"
                  icon={<Download size={15} strokeWidth={1.75} aria-hidden />}
                  onClick={() => window.open(urlDelConvenio(props.treatmentPlanId, true), "_blank", "noopener")}
                >
                  Descargar convenio
                </Btn>
              </div>
            ) : null}

            {panel.recargoSugerido > 0 ? (
              <div className={`${orto.aviso} ${orto.avisoAlerta} mx-[18px] mt-[14px]`} style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
                <AlertTriangle size={15} strokeWidth={1.75} className={`${orto.tonoAlerta} shrink-0 mt-[1px]`} aria-hidden />
                <span className={orto.avisoTexto}>
                  Recargo por atraso sugerido: <strong className="tabular-nums">{fmtMoney(panel.recargoSugerido)}</strong>. No se cobra solo ni se suma a la mensualidad (un monto de más se abonaría a la cuota siguiente): si la clínica decide aplicarlo, cóbralo con «Cobrar extra».
                </span>
              </div>
            ) : null}

            {panel.billingDelCaso.discountLabel ? (
              <div className="mx-[18px] mt-[14px] text-xs text-[color:var(--pr-texto-3)]">
                Descuento acordado para este caso (es un apunte: ya debe estar en el precio de la factura): <strong>{panel.billingDelCaso.discountLabel}</strong> ({panel.billingDelCaso.discountPct}%)
              </div>
            ) : null}

            {panel.cobranza ? (
              <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h4 className={orto.bloqueTitulo}>Calendario de mensualidades</h4>
                  <div className="flex items-center gap-[6px] flex-wrap">
                    <Pill color="emerald" size="xs">Pagada</Pill>
                    <Pill color="rose" size="xs">Vencida</Pill>
                    <Pill color="slate" size="xs">Por vencer</Pill>
                  </div>
                </div>
                {calendarioCompleto(panel.cobranza).length === 0 ? (
                  <p className={orto.vacioLinea}>Pago único, sin calendario de mensualidades.</p>
                ) : (
                  // Las casillas se acomodan solas al ancho: con ocho columnas fijas,
                  // en el teléfono el importe no cabía en la suya.
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
                    {calendarioCompleto(panel.cobranza).map((q) => (
                      <div key={`${q.esEnganche ? "e" : "p"}-${q.numero}`} className={`${orto.caja} text-center ${ESTILO_CUOTA[q.estado]}`} style={{ padding: "8px 6px" }}>
                        <div className="text-[11px] font-semibold opacity-80">{q.esEnganche ? "Enganche" : `Mes ${q.numero}`}</div>
                        <div className="text-[13px] tabular-nums font-bold mt-[1px] whitespace-nowrap">{fmtMoney(q.importe)}</div>
                        {/* ronda 3 (ws1-t2, H21c): abonada a medias no se distinguía de una
                            sin tocar — mismo color, mismo texto. */}
                        {q.abonado > 0 && q.abonado < q.importe ? (
                          <div className="text-[10px] mt-[1px] font-semibold whitespace-nowrap">Abonado {fmtMoney(q.abonado)}</div>
                        ) : null}
                        <div className="text-[11px] mt-[1px] opacity-80 whitespace-nowrap">{fmtDay(q.vencimiento)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="px-[18px] py-4 border-b border-[color:var(--pr-borde-suave)]">
              <h4 className={`${orto.bloqueTitulo} mb-[4px]`}>Reposiciones incluidas</h4>
              <p className="text-[13px] text-[color:var(--pr-texto-2)]">
                {panel.billingDelCaso.includedReplacementsUsed} de {panel.billingDelCaso.includedReplacementsTotal} usadas
              </p>
            </div>

            {panel.promesas.filter((p) => !p.fulfilledAt && !p.cancelledAt).length > 0 ? (
              <div className="px-[18px] py-4 border-b border-[color:var(--pr-borde-suave)]">
                <h4 className={`${orto.bloqueTitulo} mb-2`}>Promesas de pago abiertas</h4>
                <ul className="flex flex-col gap-[6px]">
                  {panel.promesas.filter((p) => !p.fulfilledAt && !p.cancelledAt).map((p) => (
                    <li key={p.id} className={`${orto.caja} flex items-center justify-between gap-x-3 gap-y-1 flex-wrap text-[13px]`}>
                      <span className="min-w-0 [overflow-wrap:anywhere]"><strong className="tabular-nums">{fmtMoney(p.amount)}</strong> · promete pagar el {fmtDay(p.promisedDate)}{p.note ? ` · ${p.note}` : ""}</span>
                      <span className="flex gap-3">
                        <button type="button" className={`${orto.enlace} ${orto.tonoExito}`} onClick={() => resolverPromesaDePago({ treatmentPlanId: props.treatmentPlanId, promiseId: p.id, resultado: "cumplida" }).then(recargar)}>
                          Cumplida
                        </button>
                        <button type="button" className={`${orto.enlace} ${orto.tonoApagado}`} onClick={() => resolverPromesaDePago({ treatmentPlanId: props.treatmentPlanId, promiseId: p.id, resultado: "cancelada" }).then(recargar)}>
                          Cancelar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {panel.extras.length > 0 ? (
              <div className="px-[18px] py-4">
                {/* ronda 3 (ws1-t2, H21b): decía «cobrados aparte» pero listaba
                    CUALQUIER extra, pagado o no (`listarExtrasDelCaso` trae los
                    dos a propósito) — una factura sin cobrar salía como si ya
                    se hubiera pagado. Título genérico + pill de estado por fila. */}
                <h4 className={`${orto.bloqueTitulo} mb-2`}>Extras</h4>
                <div className={orto.filas}>
                  {panel.extras.map((e) => {
                    const pagada = e.status === "PAID";
                    return (
                      <div key={e.invoiceId} className={orto.fila}>
                        <span className={orto.filaEtiqueta}>{e.invoiceNumber ?? e.invoiceId} · {fmtDateShort(e.createdAt)}</span>
                        <span className="flex items-center gap-2">
                          <Pill color={pagada ? "emerald" : "rose"} size="xs">{pagada ? "Pagada" : "Pendiente"}</Pill>
                          <span className={orto.filaValor}>{fmtMoney(e.total)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {bloqueControlesPorCobrar}

            <div className={`${orto.tarjetaPie} text-[11.5px] text-[color:var(--pr-texto-3)]`}>
              {/* ws1-t1 (sep-2026): decisión de Rafael — cada pago se factura
                  como su propio CFDI PUE (igual que la suscripción del plan),
                  NO como PPD. El botón vive en el detalle de la factura
                  (Facturación / ficha del paciente → esta factura →
                  "Facturar este pago", junto a cada pago). El cobro
                  automático con tarjeta sigue sin estar disponible aquí. */}
              El CFDI de cada mensualidad se factura desde la factura del tratamiento: ábrela en
              Facturación o en la ficha del paciente y usa «Facturar este pago» junto al pago que
              quieras timbrar. El cobro automático con tarjeta todavía no está disponible aquí.
            </div>
          </>
        )}
      </Card>

      {drawer?.kind === "abrir-plan" ? (
        <InvoiceEditorModal
          open
          patientId={props.patientId}
          patientName={props.patientName}
          rediseno={panel.redisenoFacturas}
          clinicTaxMode={panel.clinicTaxMode}
          inicial={panel.borradorInicial}
          onClose={() => setDrawer(null)}
          // X4 (dos pestañas): antes de crear, ¿el caso sigue sin plan? Si otra
          // pestaña ya lo abrió, no se crea la segunda factura y se recarga.
          antesDeCrear={async () => {
            const r = await comprobarPlanDePagoLibre({ treatmentPlanId: props.treatmentPlanId });
            if (isFailure(r) || r.data.libre) return null;
            cerrarYRecargar();
            return `Este caso ya tiene su plan de pago abierto${r.data.invoiceNumber ? ` (${r.data.invoiceNumber})` : ""}, quizá desde otra pestaña. No se creó otra factura.`;
          }}
          onCreated={async (invoice: { id: string }) => {
            const r = await abrirPlanDePago({ treatmentPlanId: props.treatmentPlanId, invoiceId: invoice.id });
            if (isFailure(r)) { window.alert(r.error); }
            // X4: otra pestaña ganó — esta se queda con la factura que ya estaba ligada.
            else if (r.data.aviso) { window.alert(r.data.aviso); }
            cerrarYRecargar();
          }}
        />
      ) : null}

      {drawer?.kind === "ligar-factura" ? (
        <DrawerLigarFactura
          treatmentPlanId={props.treatmentPlanId}
          onClose={() => setDrawer(null)}
          onLigada={cerrarYRecargar}
        />
      ) : null}

      {controlACobrar ? (
        <CobrarEnFactura
          invoiceId={controlACobrar.invoiceId}
          patientName={props.patientName}
          montoSugerido={controlACobrar.balance}
          rediseno={panel.redisenoFacturas}
          clinicTaxMode={panel.clinicTaxMode}
          onClose={() => setDrawer(null)}
          onRefrescar={recargar}
        />
      ) : null}

      {drawer?.kind === "cobrar" && idFacturaACobrar ? (
        <CobrarEnFactura
          invoiceId={idFacturaACobrar}
          patientName={props.patientName}
          montoSugerido={montoCobrarSugerido}
          rediseno={panel.redisenoFacturas}
          clinicTaxMode={panel.clinicTaxMode}
          onClose={() => setDrawer(null)}
          onRefrescar={recargar}
        />
      ) : null}

      {drawer?.kind === "extra" ? (
        <DrawerCobrarExtra
          treatmentPlanId={props.treatmentPlanId}
          patientId={props.patientId}
          patientName={props.patientName ?? ""}
          reposicionesRestantes={Math.max(0, panel.billingDelCaso.includedReplacementsTotal - panel.billingDelCaso.includedReplacementsUsed)}
          borradorBase={panel.borradorInicial}
          catalogo={panel.catalogoDeExtras}
          rediseno={panel.redisenoFacturas}
          clinicTaxMode={panel.clinicTaxMode}
          onClose={() => setDrawer(null)}
          onListo={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "cambiar-plan" && panel.invoiceId ? (
        <DrawerCambiarPlanDePago
          treatmentPlanId={props.treatmentPlanId}
          invoiceId={panel.invoiceId}
          total={panel.invoice!.total}
          condicionesActuales={panel.condiciones}
          onClose={() => setDrawer(null)}
          onGuardado={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "descuento" ? (
        <DrawerElegirDescuento
          treatmentPlanId={props.treatmentPlanId}
          reglas={panel.config.discountRules}
          actual={{ ruleId: panel.billingDelCaso.discountRuleId }}
          onClose={() => setDrawer(null)}
          onGuardado={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "promesa" && panel.cobranza ? (
        <DrawerPromesaDePago
          treatmentPlanId={props.treatmentPlanId}
          montoSugerido={panel.cobranza.vencidas.reduce((acc, q) => acc + q.falta, 0) || panel.cobranza.cuotaDeHoy?.falta || 0}
          onClose={() => setDrawer(null)}
          onGuardado={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "config" ? (
        <DrawerConfigCobro config={panel.config} onClose={() => setDrawer(null)} onGuardado={cerrarYRecargar} />
      ) : null}
    </>
  );
}

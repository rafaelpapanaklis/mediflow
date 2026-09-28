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
// SIEMPRE (`InvoiceEditorModal`, `PaymentModal`) — nunca se toca
// `src/app/api/invoices/**`. F6 (CFDI de mensualidades) y F13 (cobro
// automático con tarjeta) quedan pendientes de Rafael — ver el hueco abajo.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Percent, Plus, Printer, Settings2, Wallet } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDateShort, fmtDay, fmtMoney } from "../atoms/format";
import { InvoiceEditorModal } from "@/components/billing/invoice-editor-modal";
import { PaymentModal, type PaymentInvoice } from "@/components/dashboard/billing/payment-modal";
import { DrawerCambiarPlanDePago } from "../drawers/DrawerCambiarPlanDePago";
import { DrawerCobrarExtra } from "../drawers/DrawerCobrarExtra";
import { DrawerConfigCobro } from "../drawers/DrawerConfigCobro";
import { DrawerElegirDescuento } from "../drawers/DrawerElegirDescuento";
import { DrawerPromesaDePago } from "../drawers/DrawerPromesaDePago";
import { cargarPanelDeCobro, type PanelDeCobro } from "@/app/actions/orthodontics/cobro/cargarPanelDeCobro";
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
 * Hallazgo ws1-t4 §8: «Imprimir convenio» llamaba a `window.print()` a
 * secas, que imprime la PESTAÑA ENTERA. Primer intento (CSS con
 * `visibility: hidden` en `*` + una clase en `<body>`) tumbó dev.108: un
 * selector `:global(...) *` sin ninguna clase local no es válido en un
 * CSS Module (`Syntax error: ... is not pure`), y ESO rompe la compilación
 * de TODO el bundle, no solo esta pantalla. Vista de impresión propia,
 * sin tocar ningún CSS Module: se abre una pestaña nueva con SOLO el
 * convenio (HTML/CSS inline, sin depender de ninguna hoja de estilos del
 * panel) y se imprime esa pestaña — mismo criterio que ya usa
 * `invoice-detail-modal.tsx` para "Imprimir comprobante" (pestaña nueva,
 * no `window.print()` sobre la página actual).
 */
function imprimirConvenio(data: {
  patientName: string;
  total: number;
  paid: number;
  balance: number;
  discountLabel: string | null;
  discountPct: number | null;
  cuotas: CuotaConEstado[];
}) {
  const fila = (a: string, b: string) =>
    `<tr><td style="border:1px solid #999;padding:6px 10px;text-align:left">${a}</td><td style="border:1px solid #999;padding:6px 10px;text-align:left">${b}</td></tr>`;
  const filaCuota = (c: CuotaConEstado) =>
    `<tr>
      <td style="border:1px solid #999;padding:6px 10px;text-align:left">${c.esEnganche ? "Enganche" : `Mensualidad ${c.numero}`}</td>
      <td style="border:1px solid #999;padding:6px 10px;text-align:left">${fmtDay(c.vencimiento)}</td>
      <td style="border:1px solid #999;padding:6px 10px;text-align:left">${fmtMoney(c.importe)}</td>
    </tr>`;
  const tablaCuotas =
    data.cuotas.length > 0
      ? `<table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="border:1px solid #999;padding:6px 10px;text-align:left;font-weight:700;background:#eee">Pago</th>
            <th style="border:1px solid #999;padding:6px 10px;text-align:left;font-weight:700;background:#eee">Vence</th>
            <th style="border:1px solid #999;padding:6px 10px;text-align:left;font-weight:700;background:#eee">Importe</th>
          </tr></thead>
          <tbody>${data.cuotas.map(filaCuota).join("")}</tbody>
        </table>`
      : "";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Convenio de pago</title></head>
<body style="font-family: Arial, sans-serif; color:#000; background:#fff; padding:24px; max-width:640px; margin:0 auto;">
  <h2 style="font-size:18px;font-weight:700;margin-bottom:4px;">Convenio de pago</h2>
  <p style="margin-bottom:16px;">${data.patientName} · ${fmtDateShort(new Date().toISOString())}</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <tbody>
      ${fila("Total del tratamiento", fmtMoney(data.total))}
      ${fila("Pagado", fmtMoney(data.paid))}
      ${fila("Saldo pendiente", fmtMoney(data.balance))}
      ${data.discountLabel ? fila("Descuento acordado", `${data.discountLabel} (${data.discountPct}%)`) : ""}
    </tbody>
  </table>
  ${tablaCuotas}
  <p style="margin-top:40px;">_________________________________</p>
  <p>Firma del paciente / responsable</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;
  const ventana = window.open("", "_blank");
  if (!ventana) return; // bloqueador de pop-ups: sin ventana, no hay nada que imprimir
  ventana.document.write(html);
  ventana.document.close();
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

  const invoiceComoPago: PaymentInvoice | null = panel.invoice
    ? { id: panel.invoice.id, invoiceNumber: panel.invoice.invoiceNumber ?? "", total: panel.invoice.total, paid: panel.invoice.paid, balance: panel.invoice.balance, status: panel.invoice.status, patientName: props.patientName }
    : null;

  const esPorControl = panel.billingMode === "PAGO_POR_CONTROL";
  const hayDeudaDeControles = Boolean(panel.cobranza && (panel.cobranza.vencidas.length > 0 || panel.cobranza.proximas.length > 0));

  // ronda 3 (ws1-t2, H6): lo que se sugiere cobrar con «Cobrar» — TODO lo
  // vencido (si hay), si no la cuota de hoy. Mismo criterio que ya usaba
  // «Registrar promesa de pago» (montoSugerido, abajo): un solo número, no
  // dos que puedan discrepar entre el rótulo del botón y lo que precarga el
  // modal.
  const montoCobrarSugerido = panel.cobranza
    ? panel.cobranza.vencidas.reduce((acc, q) => acc + q.falta, 0) || panel.cobranza.cuotaDeHoy?.falta || 0
    : 0;

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
              <Btn variant="primary" className="mt-1" icon={<Plus size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "abrir-plan" })}>
                {esPorControl ? "Abrir factura de colocación/enganche" : "Abrir plan de pago"}
              </Btn>
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
                  <div className={orto.datoEtiqueta}>Saldo pendiente</div>
                  <div className={`${orto.datoValor} ${orto.datoValorGrande} ${panel.invoice!.balance > 0 ? orto.tonoPeligro : ""}`}>{fmtMoney(panel.invoice!.balance)}</div>
                  {panel.cobranza?.saldoAFavor ? (
                    <div className={`${orto.datoSub} ${orto.tonoExito}`}>Saldo a favor: {fmtMoney(panel.cobranza.saldoAFavor)}</div>
                  ) : null}
                </div>
              </div>
              <ProgressBar value={panel.invoice!.paid} max={panel.invoice!.total} color="emerald" className="mt-[12px]" ariaLabel="Avance de pagos" />
            </div>

            {panel.cobranza ? (
              <div className="px-[18px] py-[14px] border-b border-[color:var(--pr-borde-suave)] flex flex-wrap items-center gap-2">
                <Btn variant="primary" size="md" icon={<Banknote size={15} strokeWidth={1.75} aria-hidden />} onClick={() => setDrawer({ kind: "cobrar" })}>
                  Cobrar {montoCobrarSugerido > 0 ? `· ${fmtMoney(montoCobrarSugerido)}` : ""}
                </Btn>
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
                  onClick={() =>
                    imprimirConvenio({
                      patientName: props.patientName ?? "Paciente",
                      total: panel.invoice!.total,
                      paid: panel.invoice!.paid,
                      balance: panel.invoice!.balance,
                      discountLabel: panel.billingDelCaso.discountLabel,
                      discountPct: panel.billingDelCaso.discountPct,
                      cuotas: panel.cobranza ? calendarioCompleto(panel.cobranza) : [],
                    })
                  }
                >
                  Imprimir convenio
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

      {drawer?.kind === "cobrar" && invoiceComoPago ? (
        <PaymentModal open invoice={invoiceComoPago} onClose={() => setDrawer(null)} onSuccess={cerrarYRecargar} rediseno={panel.redisenoFacturas} montoSugerido={montoCobrarSugerido} />
      ) : null}

      {drawer?.kind === "extra" ? (
        <DrawerCobrarExtra
          treatmentPlanId={props.treatmentPlanId}
          patientId={props.patientId}
          patientName={props.patientName ?? ""}
          reposicionesRestantes={Math.max(0, panel.billingDelCaso.includedReplacementsTotal - panel.billingDelCaso.includedReplacementsUsed)}
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

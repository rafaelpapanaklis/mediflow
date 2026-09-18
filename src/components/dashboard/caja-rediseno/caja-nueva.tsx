"use client";

/**
 * Caja reestructurada (ws1-t6): la MISMA pantalla, con cinco bloques en vez
 * de veintiséis.
 *
 * Solo la monta `CajaClient` cuando la clínica tiene encendido el
 * interruptor `menu-dos-niveles`; con él apagado no se importa ni se pinta
 * y Caja es la de siempre, byte a byte.
 *
 * Es ROPA, no motor: no tiene estado propio (salvo ninguno), no llama a la
 * red y no calcula dinero. Todo —cifras, formateadores, la regla del turno
 * sin cortar, los modales y sus manejadores— sigue viviendo en
 * `caja-client.tsx`, que se lo pasa por props. Apertura, corte, retiro y
 * PIN no cambian.
 *
 * Las tres leyes de Rafael:
 *  1. Nada de lo que hoy se ve sin clic queda detrás de un clic. Las diez
 *     cifras del turno, los retiros con su motivo, las cuatro del día y la
 *     tabla de ventas están a la vista. Se agrupan, no se esconden.
 *  2. Nunca más clics que hoy. Abrir, retirar, cerrar, Excel: un clic, como
 *     hoy. Historial: un clic, como hoy.
 *  3. Nada se esconde por ancho: las rejillas se apilan por contenedor.
 */

import React, { type ReactNode } from "react";
import {
  Wallet, TrendingUp, Receipt, ArrowDownCircle, Banknote, Lock, Download,
  AlertTriangle, Clock, ChevronDown, ChevronRight, History, ListOrdered, type LucideIcon,
} from "lucide-react";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import type { CajaState, CajaHistoryRow } from "@/lib/caja";
import { clasesCaja } from "./raiz";
import s from "./caja-nueva.module.css";

type Fila = CajaState["list"][number];

export interface CajaNuevaProps {
  caja:     CajaState;
  history:  CajaHistoryRow[];
  /** Pestaña activa y su cambio: el estado vive en `CajaClient` (lee `?tab=`). */
  tab:      "caja" | "facturas";
  onTab:    (tab: "caja" | "facturas") => void;
  /** La pestaña Facturas ya montada (`BillingClient`), tal cual la de siempre. */
  facturas: ReactNode;
  /** Aviso de turno sin cortar, calculado en `CajaClient` con la regla de lib/caja-turno. */
  staleShift: { hours: number; crossedDay: boolean } | null;
  /** «Cobrado hoy» = facturado − por cobrar, como hoy. */
  collectedToday: number;
  /** El turno cruza más de un día natural: las filas llevan fecha y separador de día. */
  listMultiDay: boolean;
  dayKey:  (at: string) => string;
  dayAgg:  Map<string, { count: number; total: number }>;
  fmtTime:     (iso: string) => string;
  fmtDateTime: (iso: string) => string;
  fmtDayShort: (iso: string) => string;
  fmtDayLong:  (iso: string) => string;
  methodLabel: (m: string) => string;
  isRefundRow: (r: { method: string }) => boolean;
  signedAmount: (r: { method: string; amount: number }) => string;
  varianceTone: (v: number) => "success" | "info" | "danger";
  showHistory:     boolean;
  onToggleHistory: () => void;
  onOpen:       () => void;
  onWithdrawal: () => void;
  onClose:      () => void;
  onDownloadCsv: () => void;
}

export function CajaNueva(p: CajaNuevaProps) {
  const t = useT();
  const { caja, history, tab } = p;
  const reg    = caja.register;
  const totals = caja.totals;
  const abierta = !!(reg && totals);

  return (
    <>
      {/* ── Cabecera: título · estado · acciones · pestañas ─────────── */}
      <div className={s.cabecera}>
        <div className={s.cabeceraFila}>
          <div>
            <h1 className={clasesCaja.titulo}>{t("cashRegister.title")}</h1>
            <p className={clasesCaja.subtitulo}>{t("cashRegister.subtitle")}</p>
          </div>
          <div className={s.cabeceraDerecha}>
            {abierta && reg ? (
              <>
                <span className={s.estado}>
                  <span className={`${s.estadoChip} ${s.estadoAbierta}`}>{t("cashRegister.nueva.abierta")}</span>
                  <span>{t("cashRegister.openedBy", { name: reg.operatorName })} · {t("cashRegister.openedAt", { time: p.fmtDateTime(reg.openedAt) })}</span>
                </span>
                <div className={s.acciones}>
                  <ButtonNew variant="secondary" icon={<ArrowDownCircle size={16} strokeWidth={1.75} />} onClick={p.onWithdrawal}>
                    {t("cashRegister.withdrawalCta")}
                  </ButtonNew>
                  <ButtonNew variant="primary" icon={<Lock size={16} strokeWidth={1.75} />} onClick={p.onClose}>
                    {t("cashRegister.closeCta")}
                  </ButtonNew>
                </div>
              </>
            ) : (
              <>
                <span className={s.estado}>
                  <span className={`${s.estadoChip} ${s.estadoCerrada}`}>{t("cashRegister.closedTitle")}</span>
                </span>
                <div className={s.acciones}>
                  <ButtonNew variant="primary" icon={<Wallet size={16} strokeWidth={1.75} />} onClick={p.onOpen}>
                    {t("cashRegister.openCta")}
                  </ButtonNew>
                </div>
              </>
            )}
          </div>
        </div>
        <div className={`segment-new ${s.pestanas}`} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "caja"} onClick={() => p.onTab("caja")}
            className={`segment-new__btn ${tab === "caja" ? "segment-new__btn--active" : ""}`}>
            {t("cashRegister.tabCaja")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "facturas"} onClick={() => p.onTab("facturas")}
            className={`segment-new__btn ${tab === "facturas" ? "segment-new__btn--active" : ""}`}>
            {t("cashRegister.tabInvoices")}
          </button>
        </div>
      </div>

      {tab === "facturas" ? p.facturas : (
        <div className={s.cuerpo}>
          {/* Aviso de turno sin cortar: solo informa, como hoy. */}
          {abierta && reg && p.staleShift && (
            <div className={s.aviso} role="status">
              <Clock size={16} strokeWidth={1.75} aria-hidden />
              <div>
                <div className={s.avisoTitulo}>
                  {t("cashRegister.staleShiftTitle", { date: p.fmtDateTime(reg.openedAt), hours: p.staleShift.hours })}
                </div>
                <div className={s.avisoTexto}>{t("cashRegister.staleShiftDesc")}</div>
              </div>
            </div>
          )}

          {/* ── Hoy en la clínica: las cuatro cifras del día, en una tira ── */}
          <section className={`${s.tarjeta} ${s.tira}`} aria-label={t("cashRegister.nueva.hoy")}>
            <Cifra etiqueta={t("cashRegister.nueva.facturadoHoy")} icono={Receipt}       valor={fmtMXNdec(caja.billedToday)} />
            <Cifra etiqueta={t("cashRegister.nueva.cobradoHoy")}   icono={TrendingUp}    valor={fmtMXNdec(p.collectedToday)} hero />
            <Cifra etiqueta={t("cashRegister.nueva.porCobrar")}    icono={Wallet}        valor={fmtMXNdec(caja.pendingToday)} />
            <Cifra etiqueta={t("cashRegister.nueva.vencido")}      icono={AlertTriangle} valor={fmtMXNdec(caja.overdueToday)} peligro={caja.overdueToday > 0} />
          </section>

          {!abierta || !reg || !totals ? (
            /* ── Caja cerrada ── */
            <section className={s.tarjeta}>
              <div className={s.cerrada}>
                <span className={s.cerradaIcono}><Wallet size={22} strokeWidth={1.75} aria-hidden /></span>
                <div className={s.cerradaTitulo}>{t("cashRegister.closedTitle")}</div>
                <p className={s.cerradaTexto}>{t("cashRegister.closedDesc")}</p>
                {/* La cifra con la que se prefija la apertura: hoy solo se ve
                    dentro del modal. Aquí se adelanta; el valor es el mismo. */}
                <p className={s.cerradaSugerido}>
                  {t("cashRegister.nueva.sugerido")} <strong>{fmtMXNdec(caja.suggestedOpening)}</strong>
                </p>
                <ButtonNew variant="primary" icon={<Wallet size={16} strokeWidth={1.75} />} onClick={p.onOpen}>
                  {t("cashRegister.openCta")}
                </ButtonNew>
              </div>
            </section>
          ) : (
            <div className={s.rejilla}>
              {/* ── Arqueo: un recibo con las diez cifras del turno ── */}
              <section className={s.tarjeta} aria-label={t("cashRegister.nueva.arqueo")}>
                <header className={s.tarjetaCabeza}>
                  <div className={s.tarjetaTextos}>
                    <span className={s.tarjetaIcono}><Banknote size={15} strokeWidth={1.75} aria-hidden /></span>
                    <h2 className={s.tarjetaTitulo}>{t("cashRegister.nueva.arqueo")}</h2>
                  </div>
                </header>
                <div className={s.arqueoBloques}>
                  {/* Efectivo: apertura + efectivo cobrado − retiros = esperado.
                      Es la cuenta que hace la recepcionista con el cajón delante. */}
                  <div className={s.arqueoBloque}>
                    <p className={s.arqueoRotulo}>{t("cashRegister.nueva.efectivoEnCaja")}</p>
                    <Linea etiqueta={t("cashRegister.kpiOpening")}          valor={fmtMXNdec(totals.openingBalance)} />
                    <Linea etiqueta={t("cashRegister.nueva.efectivoCobrado")} valor={fmtMXNdec(totals.cashIncome)} signo="+" />
                    <Linea etiqueta={t("cashRegister.kpiWithdrawals")}      valor={fmtMXNdec(totals.withdrawals)} signo="−" negativo={totals.withdrawals > 0} />
                    {caja.withdrawals.map(w => (
                      <div key={w.id} className={s.subfila}>
                        <span className={s.subfilaTexto}>
                          {w.reason} <span className={s.subfilaMeta}>· {p.fmtTime(w.recordedAt)} · {w.recordedByName}</span>
                        </span>
                        <span className={s.subfilaValor}>−{fmtMXNdec(w.amount)}</span>
                      </div>
                    ))}
                    {/* Los reembolsos en efectivo también restan del esperado
                        (expectedCashOf, en el servidor); la cifra viene hecha. */}
                    <Linea etiqueta={t("cashRegister.kpiExpectedCash")} valor={fmtMXNdec(totals.expectedCash)} signo="=" total />
                  </div>

                  {/* Ingresos: por método, y lo que se descontó y se cobró de IVA. */}
                  <div className={s.arqueoBloque}>
                    <p className={s.arqueoRotulo}>{t("cashRegister.nueva.ingresosPorMetodo")}</p>
                    <Linea etiqueta={t("cashRegister.methodCash")}   valor={fmtMXNdec(totals.cashIncome)} />
                    <Linea etiqueta={t("cashRegister.methodDebit")}  valor={fmtMXNdec(totals.cardDebitIncome)} />
                    <Linea etiqueta={t("cashRegister.methodCredit")} valor={fmtMXNdec(totals.cardCreditIncome)} />
                    {/* Misma condición que hoy: solo si hubo transferencia / cheque / otro. */}
                    {totals.otherIncome > 0 && (
                      <Linea etiqueta={t("cashRegister.nueva.otrosMetodos")} valor={fmtMXNdec(totals.otherIncome)} />
                    )}
                    {/* Reembolsos: en NEGATIVO y solo si hubo alguno, como hoy. No suman. */}
                    {totals.refunds > 0 && (
                      <Linea etiqueta={t("cashRegister.kpiRefunds")} valor={`−${fmtMXNdec(totals.refunds)}`} negativo />
                    )}
                    <Linea etiqueta={t("cashRegister.kpiIncome")} valor={fmtMXNdec(totals.totalIncome)} signo="=" total />
                    <Linea etiqueta={t("cashRegister.kpiDiscounts")} valor={fmtMXNdec(totals.discounts)} />
                    <Linea etiqueta={t("cashRegister.kpiTax")}       valor={fmtMXNdec(totals.tax)} />
                  </div>
                </div>
              </section>

              {/* ── Ventas del turno: lo que se mira cada cinco minutos ── */}
              <section className={s.tarjeta} aria-label={t("cashRegister.shiftSalesTitle")}>
                <header className={s.tarjetaCabeza}>
                  <div className={s.tarjetaTextos}>
                    <span className={s.tarjetaIcono}><ListOrdered size={15} strokeWidth={1.75} aria-hidden /></span>
                    <div>
                      <h2 className={s.tarjetaTitulo}>{t("cashRegister.shiftSalesTitle")}</h2>
                      <p className={s.tarjetaSub}>{t("cashRegister.shiftSalesSince", { date: p.fmtDateTime(reg.openedAt) })}</p>
                    </div>
                  </div>
                  <ButtonNew variant="secondary" size="sm" icon={<Download size={15} strokeWidth={1.75} />} onClick={p.onDownloadCsv} disabled={caja.list.length === 0}>
                    {t("cashRegister.nueva.descargarExcel")}
                  </ButtonNew>
                </header>
                {caja.list.length === 0 ? (
                  <div className={s.vacioTabla}>{t("cashRegister.emptyList")}</div>
                ) : (
                  <div className={s.tablaEnvoltura}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>{p.listMultiDay ? t("cashRegister.thDateTime") : t("cashRegister.thTime")}</th>
                          <th>{t("cashRegister.thPatient")}</th>
                          <th>{t("cashRegister.thConcept")}</th>
                          <th>{t("cashRegister.thMethod")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thAmount")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.nueva.descuento")}</th>
                          <th>{t("cashRegister.thDoctor")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caja.list.map((r, i) => {
                          const k = p.dayKey(r.at);
                          const newDay = p.listMultiDay && (i === 0 || p.dayKey(caja.list[i - 1].at) !== k);
                          const agg = p.dayAgg.get(k);
                          return (
                            <React.Fragment key={r.paymentId}>
                              {newDay && (
                                <tr className={s.tablaDia}>
                                  <td colSpan={7}>
                                    <div className={s.tablaDiaFila}>
                                      <span className={s.tablaDiaNombre}>{p.fmtDayLong(r.at)}</span>
                                      {agg && (
                                        <span className={s.tablaDiaMeta}>
                                          {t("cashRegister.dayGroupMeta", { count: agg.count, amount: fmtMXNdec(agg.total) })}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                              <FilaVenta r={r} multiDay={p.listMultiDay} p={p} />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── Historial de cortes: colapsado, un clic, igual que hoy ── */}
          <div className={s.historial}>
            <button type="button" className={s.historialBoton} onClick={p.onToggleHistory} aria-expanded={p.showHistory}>
              {p.showHistory ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
              <History size={16} strokeWidth={1.75} aria-hidden /> {t("cashRegister.historyTitle")} ({history.length})
            </button>
            {p.showHistory && (
              <section className={s.tarjeta}>
                {history.length === 0 ? (
                  <div className={s.historialVacio}>{t("cashRegister.historyEmpty")}</div>
                ) : (
                  <div className={s.tablaEnvoltura}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>{t("cashRegister.thOpened")}</th>
                          <th>{t("cashRegister.thClosed")}</th>
                          <th>{t("cashRegister.thOperator")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.kpiOpening")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thExpected")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thCounted")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thVariance")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id}>
                            <td className={s.tablaHora}>{p.fmtDateTime(h.openedAt)}</td>
                            <td className={s.tablaHora}>{h.closedAt ? p.fmtDateTime(h.closedAt) : "—"}</td>
                            <td className={s.tablaTexto}>{h.operatorName}</td>
                            <td className={s.historialCifra}>{fmtMXNdec(h.openingBalance)}</td>
                            <td className={s.historialCifra}>{h.expectedCash == null ? "—" : fmtMXNdec(h.expectedCash)}</td>
                            <td className={`${s.historialCifra} ${s.historialCifraFuerte}`}>{h.countedClosingBalance == null ? "—" : fmtMXNdec(h.countedClosingBalance)}</td>
                            <td className={s.historialCifra}>
                              {h.variance == null ? "—" : <BadgeNew tone={p.varianceTone(h.variance)}>{fmtMXNdec(h.variance)}</BadgeNew>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Piezas ─────────────────────────────────────────────────────────── */

/** Una celda de la tira del día: etiqueta con ícono e importe. */
function Cifra({ etiqueta, icono: Icono, valor, hero, peligro }: {
  etiqueta: string;
  icono: LucideIcon;
  valor: string;
  hero?: boolean;
  peligro?: boolean;
}) {
  return (
    <div className={s.tiraCelda}>
      <div className={s.tiraEtiqueta}><Icono size={13} strokeWidth={1.75} aria-hidden /> {etiqueta}</div>
      <div className={`${s.tiraValor} ${hero ? s.tiraValorHero : ""} ${peligro ? s.tiraValorPeligro : ""}`}>{valor}</div>
    </div>
  );
}

/** Una línea del recibo: [signo] etiqueta … importe. */
function Linea({ etiqueta, valor, signo, total, negativo }: {
  etiqueta: string;
  valor: string;
  /** «+», «−» o «=»: la operación que hace esa línea en la cuenta. */
  signo?: string;
  /** Línea de resultado: raya arriba e importe grande. */
  total?: boolean;
  negativo?: boolean;
}) {
  return (
    <div className={`${s.linea} ${total ? s.lineaTotal : ""}`}>
      <span className={s.lineaEtiqueta}>
        <span className={s.lineaSigno} aria-hidden>{signo ?? ""}</span>
        <span>{etiqueta}</span>
      </span>
      <span className={`${s.lineaValor} ${negativo ? s.lineaValorNegativo : ""}`}>{valor}</span>
    </div>
  );
}

/** Una venta del turno. Misma información y mismo orden que la tabla de hoy. */
function FilaVenta({ r, multiDay, p }: { r: Fila; multiDay: boolean; p: CajaNuevaProps }) {
  const reembolso = p.isRefundRow(r);
  return (
    <tr>
      <td className={s.tablaHora}>
        {multiDay && <span className={s.tablaFecha}>{p.fmtDayShort(r.at)}</span>}
        {p.fmtTime(r.at)}
      </td>
      <td className={s.tablaPaciente}>{r.patientName}</td>
      <td className={s.tablaTexto}>{r.concept}</td>
      <td><BadgeNew tone={reembolso ? "danger" : r.method === "cash" ? "success" : "info"}>{p.methodLabel(r.method)}</BadgeNew></td>
      <td className={`${s.tablaImporte} ${reembolso ? s.tablaImporteNegativo : ""}`}>{p.signedAmount(r)}</td>
      <td className={`${s.tablaDescuento} ${r.discount > 0 ? s.tablaDescuentoActivo : ""}`}>{r.discount > 0 ? `−${fmtMXNdec(r.discount)}` : "—"}</td>
      <td className={s.tablaTexto}>{r.doctorName}</td>
    </tr>
  );
}

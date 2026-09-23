"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Check, CreditCard, Download, ExternalLink, Info, Loader2, Receipt, Sparkles, XCircle } from "lucide-react";
import { textosMetodoPago, avisoMetodoPago, type MetodoPagoVista } from "@/lib/billing/metodo-de-pago-vista";
import type { PlanId } from "@/lib/billing/plans";
import type { ApiPlan, BillingInvoiceRow, ClinicData } from "@/components/dashboard/subscription-tab";
import { Boton, Insignia, Aviso, type Tono } from "@/components/dashboard/configuracion-rediseno/piezas";
import { Seccion } from "@/components/dashboard/configuracion-rediseno/piezas";
import { useT } from "@/i18n/i18n-provider";
import s from "./bloques.module.css";

/**
 * La ROPA nueva de la pestaña Suscripción de Configuración (hallazgo 14: 42
 * estilos en línea viejos y un modal «Cancelar suscripción» que era un div a
 * mano). Es solo vista: TODO lo que decide algo —estado del plan, intervalo
 * real de cobro, preview del cambio de plan, cancelación, facturas— sigue en
 * `subscription-tab.tsx`, que arma este modelo y la monta ÚNICAMENTE con
 * `rediseno`. Aquí no hay un solo `fetch`, ni una regla de negocio: mismos
 * textos (las mismas claves i18n), mismos botones y lo mismo al pulsarlos.
 *
 * ⛔ «Cancelar suscripción» toca el cobro de la clínica: el botón dispara la
 * MISMA función de siempre (`handleRequestCancel`) y dice lo mismo. Solo
 * cambia la caja.
 *
 * Las secciones usan las piezas de Configuración (`configuracion-rediseno/
 * piezas.tsx`) para que esta pestaña se vea como sus nueve vecinas; lo que
 * es propio de aquí (tarjetas de plan, método de pago, tabla de facturas,
 * los dos modales) vive en `bloques.module.css`.
 */

export interface ModeloSuscripcion {
  clinic: ClinicData;

  /* Estado actual del plan */
  estadoTexto: string;
  estadoTono: Tono;
  lineaPlan: string;
  enPrueba: boolean;
  finPrueba: Date | null;
  diasRestantes: number;
  totalDiasPrueba: number;
  porcentajePrueba: number;
  pruebaVencida: boolean;
  mostrarActivar: boolean;
  onActivar: () => void;

  /* Cambiar plan */
  tieneSuscripcionStripe: boolean;
  tieneClienteStripe: boolean;
  planes: ApiPlan[];
  planActualId: PlanId;
  planActual: ApiPlan | null;
  anual: boolean;
  precioDe: (p: ApiPlan) => number;
  sufijoIntervalo: string;
  beneficiosDe: (p: ApiPlan) => string[];
  cambiando: PlanId | null;
  onElegirPlan: (p: PlanId) => void;

  /* Método de pago */
  onCambiarMetodo: () => void;
  /** Lo que Stripe dice HOY, ya resuelto (@/lib/billing/metodo-de-pago-vista). */
  metodoPago: MetodoPagoVista;
  cancelacionPedida: boolean;
  onPedirCancelar: () => void;

  /* Facturas */
  facturas: BillingInvoiceRow[] | null;
  stripeNoDisponible: boolean;

  /* Modal «Cancelar suscripción» */
  cancelarAbierto: boolean;
  onCerrarCancelar: () => void;
  onConfirmarCancelar: () => void;
  cancelando: boolean;

  /* Modal de confirmación de cambio de plan */
  planAConfirmar: PlanId | null;
  onCerrarConfirmar: () => void;
  onAplicarPlan: (p: PlanId) => void;
  previewCargando: boolean;
  pagarYCambiar: boolean;
  cuerpoConfirmar: ReactNode;

  formatFecha: (d: Date) => string;
  formatMoney: (n: number, moneda: string) => string;

  /** La tarjeta «Facturación CFDI», ya vestida por quien la monta. */
  cfdi: ReactNode;
  /** El modal de método de pago, montado por quien tiene su estado. */
  modalPago: ReactNode;
}

/** Las clases del desglose del cobro dentro del modal de cambio de plan. */
export const ROPA_DESGLOSE = {
  cargando: s.cargandoLinea,
  desglose: s.desglose,
  rotulo: s.rotulo,
  fila: s.desgloseFila,
  total: `${s.desgloseFila} ${s.desgloseTotal}`,
} as const;

export type RopaDesglose = typeof ROPA_DESGLOSE;

const TONO_FACTURA: Record<BillingInvoiceRow["status"], { tono: Tono; labelKey: string }> = {
  paid:    { tono: "exito",   labelKey: "shell.subscriptionTab.statusPaid" },
  pending: { tono: "violeta", labelKey: "shell.subscriptionTab.statusPending" },
  overdue: { tono: "alerta",  labelKey: "shell.subscriptionTab.statusOverdue" },
  failed:  { tono: "peligro", labelKey: "shell.subscriptionTab.statusFailed" },
  void:    { tono: "neutro",  labelKey: "shell.subscriptionTab.statusVoid" },
};

export function SuscripcionRediseno({ m }: { m: ModeloSuscripcion }) {
  const t = useT();
  const planNombre = (id: PlanId) => m.planes.find((p) => p.id === id)?.name ?? "";

  return (
    <div className={s.suscripcion}>
      {/* ── Estado actual del plan ───────────────────────────────── */}
      <Seccion
        titulo={t("shell.subscriptionTab.yourPlan")}
        icono={<CreditCard size={16} strokeWidth={1.75} aria-hidden />}
        extra={<Insignia tono={m.estadoTono} punto>{m.estadoTexto}</Insignia>}
      >
        <div className={s.planNombre}>{m.lineaPlan}</div>

        {m.enPrueba && m.finPrueba && (
          <div>
            <div className={s.pruebaCabeza}>
              <span>
                {m.diasRestantes === 0
                  ? t("shell.subscriptionTab.endsToday")
                  : m.diasRestantes === 1
                    ? t("shell.subscriptionTab.oneDayLeft")
                    : t("shell.subscriptionTab.daysLeftOfTotal", { days: m.diasRestantes, total: m.totalDiasPrueba })}
              </span>
              <span className={s.pruebaFecha}>
                {t("shell.subscriptionTab.endsOn", { date: m.formatFecha(m.finPrueba) })}
              </span>
            </div>
            <div className={s.barra}>
              <div
                className={s.barraRelleno}
                data-nivel={m.diasRestantes <= 3 ? "critico" : undefined}
                style={{ width: `${m.porcentajePrueba}%` }}
              />
            </div>
          </div>
        )}

        {m.pruebaVencida && (
          <Aviso tono="peligro" icono={<AlertTriangle size={14} strokeWidth={1.75} aria-hidden />}>
            {t("shell.subscriptionTab.trialExpiredNotice", { date: m.finPrueba ? m.formatFecha(m.finPrueba) : "" })}
          </Aviso>
        )}

        {m.mostrarActivar && (
          <div className={s.activar}>
            <div className={s.activarTextos}>
              <div className={s.activarTitulo}>{t("shell.subscriptionTab.activateTitle")}</div>
              <div className={s.activarSub}>{t("shell.subscriptionTab.activateSubtitle")}</div>
            </div>
            <Boton variante="principal" onClick={m.onActivar}>
              <CreditCard size={14} aria-hidden />
              {t("shell.subscriptionTab.activateCta")}
            </Boton>
          </div>
        )}
      </Seccion>

      {/* ── Cambiar plan ─────────────────────────────────────────── */}
      <Seccion
        titulo={t("shell.subscriptionTab.changePlanTitle")}
        subtitulo={
          m.tieneSuscripcionStripe
            ? t("shell.subscriptionTab.changePlanDescSub")
            : t("shell.subscriptionTab.changePlanDescCheckout")
        }
        icono={<Sparkles size={16} strokeWidth={1.75} aria-hidden />}
      >
        <div className={s.planes}>
          {m.planes.map((plan) => {
            const esActual = plan.id === m.planActualId;
            const esPopular = plan.id === "PRO";
            const enCurso = m.cambiando === plan.id;
            const precio = m.precioDe(plan);
            const precioActual = m.planActual ? m.precioDe(m.planActual) : null;
            return (
              <div key={plan.id} className={`${s.plan} ${esActual ? s.planActual : ""}`}>
                <div className={s.planCabeza}>
                  <div className={s.planTitulo}>{plan.name}</div>
                  {esActual && <Insignia tono="violeta">{t("shell.subscriptionTab.currentPlanBadge")}</Insignia>}
                  {!esActual && esPopular && <Insignia tono="violeta">{t("shell.subscriptionTab.popularBadge")}</Insignia>}
                </div>
                <div className={s.precio}>
                  ${precio}
                  <span className={s.precioSufijo}>{m.sufijoIntervalo}</span>
                </div>
                {!esActual && precioActual !== null && precio !== precioActual && (
                  <div className={`${s.delta} ${precio > precioActual ? s.deltaSube : ""}`}>
                    {precio > precioActual
                      ? t(m.anual ? "shell.subscriptionTab.priceDeltaUpAnnual" : "shell.subscriptionTab.priceDeltaUp", { delta: precio - precioActual })
                      : t(m.anual ? "shell.subscriptionTab.priceDeltaDownAnnual" : "shell.subscriptionTab.priceDeltaDown", { delta: precioActual - precio })}
                  </div>
                )}
                <ul className={s.beneficios}>
                  {m.beneficiosDe(plan).map((f) => (
                    <li key={f} className={s.beneficio}>
                      <Check size={12} strokeWidth={2} aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Boton
                  variante={esActual ? "secundario" : "principal"}
                  ancho
                  onClick={() => m.onElegirPlan(plan.id)}
                  disabled={esActual || m.cambiando !== null}
                >
                  {esActual
                    ? t("shell.subscriptionTab.currentPlanBadge")
                    : enCurso
                      ? t("shell.subscriptionTab.applying")
                      : t("shell.subscriptionTab.changeToThisPlan")}
                </Boton>
              </div>
            );
          })}
        </div>
      </Seccion>

      {/* ── Método de pago ───────────────────────────────────────── */}
      <Seccion
        titulo={t("shell.subscriptionTab.paymentMethodTitle")}
        icono={<CreditCard size={16} strokeWidth={1.75} aria-hidden />}
      >
        {/* Lo que Stripe dice HOY, no lo que eligió el formulario de alta.
            Mismo resolutor que la pestaña de siempre; sin respuesta de Stripe
            no se afirma nada. Claves: cardEndingIn, cardBrandEndingIn,
            autoMonthlyCharge, autoAnnualCharge, recurringSubscription,
            bankTransfer, manualPaymentConfirmation, noPaymentMethod,
            noPaymentMethodActive, paymentMethodLoading, paymentMethodUnknown. */}
        {(() => {
          const textos = textosMetodoPago(m.metodoPago, t, m.anual);
          if (textos) {
            return (
              <div className={s.metodo}>
                <div className={s.metodoMarca} aria-hidden>{textos.marca}</div>
                <div className={s.metodoTextos}>
                  <div className={s.metodoTitulo}>{textos.titulo}</div>
                  <div className={s.metodoSub}>{textos.sub}</div>
                </div>
              </div>
            );
          }
          const aviso = avisoMetodoPago(m.metodoPago);
          return (
            <Aviso
              tono={aviso.tono}
              icono={
                aviso.tono === "alerta"
                  ? <AlertTriangle size={14} strokeWidth={1.75} aria-hidden />
                  : <Info size={14} strokeWidth={1.75} aria-hidden />
              }
            >
              {t(aviso.clave)}
            </Aviso>
          );
        })()}

        <div className={s.acciones}>
          <Boton corto onClick={m.onCambiarMetodo}>
            <CreditCard size={13} aria-hidden />
            {t("shell.subscriptionTab.changePaymentMethod")}
          </Boton>
          {!m.cancelacionPedida ? (
            <Boton corto variante="peligro" onClick={m.onPedirCancelar}>
              {t("shell.subscriptionTab.cancelSubscription")}
            </Boton>
          ) : (
            <Insignia tono="peligro" punto>{t("shell.subscriptionTab.cancellationRequestedBadge")}</Insignia>
          )}
        </div>
      </Seccion>

      {/* ── Facturación CFDI (cupo del mes + excedente + adeudo) ──── */}
      {m.cfdi}

      {/* ── Facturación ──────────────────────────────────────────── */}
      <Seccion
        titulo={t("shell.subscriptionTab.invoiceHistory")}
        icono={<Receipt size={16} strokeWidth={1.75} aria-hidden />}
        extra={
          m.tieneClienteStripe ? (
            <Boton corto onClick={m.onCambiarMetodo}>
              {t("shell.subscriptionTab.stripePortal")} <ExternalLink size={12} aria-hidden />
            </Boton>
          ) : undefined
        }
        sinRelleno={m.facturas !== null && m.facturas.length > 0}
      >
        {m.facturas === null ? (
          <div className={s.cargando}>
            <Loader2 size={16} className={s.girando} aria-hidden />
            {t("shell.subscriptionTab.loadingInvoices")}
          </div>
        ) : m.facturas.length === 0 ? (
          <div className={s.vacio}>
            {t("shell.subscriptionTab.noInvoices")}
            {m.stripeNoDisponible && (
              <div className={s.vacioNota}>{t("shell.subscriptionTab.stripeNotConfigured")}</div>
            )}
          </div>
        ) : (
          <div className={s.tablaCaja}>
            <table className={s.tabla}>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("shell.subscriptionTab.colConcept")}</th>
                  <th className={s.derecha}>{t("shell.subscriptionTab.colAmount")}</th>
                  <th>{t("common.status")}</th>
                  <th className={s.derecha}>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {m.facturas.map((inv) => {
                  const estado = TONO_FACTURA[inv.status];
                  return (
                    <tr key={inv.id}>
                      <td className={s.fecha}>
                        {new Date(inv.date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td>{inv.description}</td>
                      <td className={s.num}>{m.formatMoney(inv.amount, inv.currency)}</td>
                      <td>
                        <Insignia tono={estado.tono}>{t(estado.labelKey)}</Insignia>
                      </td>
                      <td className={s.derecha}>
                        <div className={s.filaAcciones}>
                          {inv.downloadUrl && (
                            <a
                              href={inv.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={s.enlaceBoton}
                              title={t("shell.subscriptionTab.downloadInvoice")}
                            >
                              <Download size={11} aria-hidden />
                              PDF
                            </a>
                          )}
                          {inv.paymentUrl && (
                            <a
                              href={inv.paymentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${s.enlaceBoton} ${s.enlaceBotonPrincipal}`}
                              title={t("shell.subscriptionTab.payInvoice")}
                            >
                              {t("shell.subscriptionTab.pay")}
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── Modal de cancelación: misma acción, misma frase; solo la caja ── */}
      {m.cancelarAbierto && (
        <div className={s.velo} onClick={m.onCerrarCancelar}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suscripcion-cancelar-titulo"
            className={`${s.caja} ${s.cajaPeligro}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.cajaCabeza}>
              <span className={`${s.iconoCaja} ${s.iconoCajaGrande}`} data-tono="peligro">
                <XCircle size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <div className={s.cajaTextos}>
                <h3 id="suscripcion-cancelar-titulo" className={s.cajaTitulo}>
                  {t("shell.subscriptionTab.cancelModalTitle")}
                </h3>
                <p className={s.cajaTexto}>
                  {t("shell.subscriptionTab.cancelModalBodyStart")}{" "}
                  <strong>{m.finPrueba && m.formatFecha(m.finPrueba)}</strong>{t("shell.subscriptionTab.cancelModalBodyEnd")}
                </p>
              </div>
            </div>
            <div className={s.cajaPie}>
              <Boton onClick={m.onCerrarCancelar}>{t("shell.subscriptionTab.noKeep")}</Boton>
              <button type="button" onClick={m.onConfirmarCancelar} disabled={m.cancelando} className={s.botonPeligroSolido}>
                {m.cancelando ? t("shell.subscriptionTab.processing") : t("shell.subscriptionTab.yesCancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación de cambio de plan ──────────────── */}
      {m.planAConfirmar && (
        <div className={s.velo} onClick={m.onCerrarConfirmar}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suscripcion-confirmar-titulo"
            className={s.caja}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.cajaCabeza}>
              <span className={`${s.iconoCaja} ${s.iconoCajaGrande}`}>
                <Sparkles size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <div className={s.cajaTextos}>
                <h3 id="suscripcion-confirmar-titulo" className={s.cajaTitulo}>
                  {t("shell.subscriptionTab.confirmChangeTitle", { name: planNombre(m.planAConfirmar) })}
                </h3>
                <p className={s.cajaTexto}>{m.cuerpoConfirmar}</p>
              </div>
            </div>
            <div className={s.cajaPie}>
              <Boton onClick={m.onCerrarConfirmar}>{t("common.cancel")}</Boton>
              <Boton
                variante="principal"
                onClick={() => m.onAplicarPlan(m.planAConfirmar!)}
                disabled={m.cambiando !== null || m.previewCargando}
              >
                {m.cambiando
                  ? t("shell.subscriptionTab.applying")
                  : m.pagarYCambiar
                    ? t("shell.subscriptionTab.payAndChange")
                    : t("shell.subscriptionTab.continue")}
              </Boton>
            </div>
          </div>
        </div>
      )}

      {m.modalPago}
    </div>
  );
}

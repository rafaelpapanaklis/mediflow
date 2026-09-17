"use client";

import { CheckCircle2, Plus, Receipt } from "lucide-react";
import type { PatientBillingInvoice } from "@/components/dashboard/patient-detail/billing-tab";
import {
  invoiceStatusBadge,
  isVoidedInvoice,
  isChargeableInvoice,
  type InvoiceStatusTone,
} from "@/components/dashboard/billing/invoice-status";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { RaizExpediente } from "./raiz";
import s from "./expediente.module.css";

/**
 * La PESTAÑA Facturación del expediente, con el diseño nuevo. La MISMA tabla
 * que `patient-detail/billing-tab.tsx`: folio, fecha, total, pagado, saldo,
 * estado, CFDI y «Cobrar» por fila, con «Nueva factura» arriba; los mismos
 * callbacks al padre y el mismo objeto de factura de vuelta. Solo cambia la
 * ropa.
 *
 * Lo que se abre desde aquí —el detalle de factura, el pago, la factura
 * nueva— son diálogos del padre y NO son de esta pantalla: los viste otra
 * (ws1-t3). Aquí termina la pestaña.
 *
 * El mini-resumen (total / pagado / saldo) no se pinta, igual que ya hacía
 * `billing-tab.tsx` con `redesignOn`: esta pestaña siempre va con el rail y
 * su «Estado de cuenta» enseña esas mismas tres cifras (N6).
 */

export interface FacturacionProps {
  facturas: PatientBillingInvoice[];
  facturApiEnabled: boolean;
  onNueva: () => void;
  /** Clic en la fila — abre el detalle de factura del padre. */
  onAbrir: (inv: PatientBillingInvoice) => void;
  /** «Cobrar» por fila — abre el pago directo del padre. */
  onCobrar: (inv: PatientBillingInvoice) => void;
  /** «Timbrar» — abre el detalle con el formulario SAT desplegado. */
  onTimbrar: (inv: PatientBillingInvoice) => void;
}

/** Los seis tonos de `invoice-status.ts`, en las etiquetas del rediseño. */
const TONO_ETIQUETA: Record<InvoiceStatusTone, string> = {
  success: "etiquetaExito",
  warning: "etiquetaAlerta",
  danger: "etiquetaPeligro",
  info: "etiquetaVioleta",
  brand: "etiquetaVioleta",
  neutral: "etiquetaNeutra",
};

export function Facturacion({ facturas, facturApiEnabled, onNueva, onAbrir, onCobrar, onTimbrar }: FacturacionProps) {
  const t = useT();

  return (
    <RaizExpediente>
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.cabeceraIcono}>
            <Receipt size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.titulo}>{t("patients.billing.title")}</h2>
          <div className={s.acciones}>
            <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={onNueva}>
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t("clinical.emptyStates.invoicesNewCta")}
            </button>
          </div>
        </header>

        {facturas.length === 0 ? (
          <div className={s.tablaVacia}>{t("patients.billing.empty")}</div>
        ) : (
          <div className={s.tablaCaja}>
            <table className={s.tabla}>
              <thead>
                <tr>
                  <th>{t("patients.billing.colInvoice")}</th>
                  <th>{t("common.date")}</th>
                  <th className={s.num}>{t("patients.billing.colAmount")}</th>
                  <th className={s.num}>{t("patients.billing.colPaid")}</th>
                  <th className={s.num}>{t("patients.billing.colBalance")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("billing.billingClient.thCfdi")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((inv) => {
                  const badge = invoiceStatusBadge(inv.status);
                  // Cancelar NO pone balance a 0 en BD: la columna Saldo
                  // mostraría deuda en una fila que dice «Cancelada» — se
                  // muestra «—» porque no hay nada que cobrar.
                  const anulada = isVoidedInvoice(inv);
                  return (
                    <tr key={inv.id} className={s.filaClic} onClick={() => onAbrir(inv)}>
                      <td className={`${s.fuerte} ${s.suave}`}>{inv.invoiceNumber}</td>
                      <td className={s.suave}>{formatDate(inv.createdAt)}</td>
                      <td className={s.num}>{fmtMXNdec(inv.total)}</td>
                      <td className={`${s.num} ${s.tonoExito}`}>{fmtMXNdec(inv.paid)}</td>
                      <td className={`${s.num} ${!anulada && inv.balance > 0 ? s.tonoAlerta : s.tenue}`}>
                        {anulada ? "—" : fmtMXNdec(inv.balance)}
                      </td>
                      <td>
                        <span className={`${s.etiqueta} ${(s as Record<string, string>)[TONO_ETIQUETA[badge.tone]]}`}>
                          <span className={s.etiquetaPunto} aria-hidden />
                          {t(badge.labelKey)}
                        </span>
                      </td>
                      {/* CFDI — los mismos tres estados que `invoice-cfdi-badge.tsx`:
                          ✓ «Facturado (CFDI)» si ya se timbró, «Timbrar» si el SAT
                          está configurado (y la factura no está anulada), o el
                          texto neutro. */}
                      <td onClick={(e) => e.stopPropagation()}>
                        {inv.cfdiUuid ? (
                          <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
                            <CheckCircle2 size={11} strokeWidth={2.5} aria-hidden />
                            {t("billing.billingClient.cfdiInvoiced")}
                          </span>
                        ) : facturApiEnabled ? (
                          anulada ? null : (
                            <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={() => onTimbrar(inv)}>
                              {t("billing.billingClient.cfdiStamp")}
                            </button>
                          )
                        ) : (
                          <span className={s.apagado}>{t("billing.billingClient.satNotConfigured")}</span>
                        )}
                      </td>
                      <td className={s.derecha} onClick={(e) => e.stopPropagation()}>
                        {isChargeableInvoice(inv) && (
                          <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={() => onCobrar(inv)}>
                            {t("patients.billing.rowCharge")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RaizExpediente>
  );
}

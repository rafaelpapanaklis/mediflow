"use client";

import type { CSSProperties } from "react";
import { Plus, Receipt, CheckCircle2, Clock } from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { InvoiceCfdiBadge } from "@/components/dashboard/billing/invoice-cfdi-badge";
import {
  invoiceStatusBadge,
  isVoidedInvoice,
  isChargeableInvoice,
} from "@/components/dashboard/billing/invoice-status";
import { fmtMXN, fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patient-detail.module.css";

/**
 * Forma mínima de la factura que este tab pinta. El monolito de la ficha
 * recibe las facturas del server component y las pasa tal cual; los callbacks
 * devuelven el MISMO objeto (referencia intacta), así el parent puede abrir
 * el detalle/pago con la fila completa aunque aquí solo se tipen los campos
 * que la tabla lee.
 */
export interface PatientBillingInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  paid: number;
  balance: number;
  createdAt: string | Date;
  cfdiUuid?: string | null;
}

interface BillingTabProps {
  invoices: PatientBillingInvoice[];
  /** Totales YA calculados por el parent (los mismos del rail — sin queries nuevas). */
  summary: { total: number; paid: number; balance: number };
  facturApiEnabled: boolean;
  onNewInvoice: () => void;
  /** Click en la fila — abre el InvoiceDetailModal. */
  onOpenInvoice: (inv: PatientBillingInvoice) => void;
  /** "Cobrar" por fila — abre el PaymentModal directo (DRAFT confirma primero). */
  onChargeInvoice: (inv: PatientBillingInvoice) => void;
  /** Badge CFDI "Timbrar" — abre el detalle con el formulario SAT desplegado. */
  onStampInvoice: (inv: PatientBillingInvoice) => void;
}

const MONEY_CELL: CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

export function BillingTab({
  invoices,
  summary,
  facturApiEnabled,
  onNewInvoice,
  onOpenInvoice,
  onChargeInvoice,
  onStampInvoice,
}: BillingTabProps) {
  const t = useT();

  return (
    <div>
      {/* Mini-resumen — mismos datos que el card "Estado de cuenta" del rail. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <KpiCard label={t("patients.sideCards.treatmentTotal")} value={fmtMXN(summary.total)} icon={Receipt} />
        <KpiCard label={t("patients.sideCards.paid")} value={fmtMXN(summary.paid)} icon={CheckCircle2} />
        <KpiCard label={t("patients.sideCards.pendingBalance")} value={fmtMXN(summary.balance)} icon={Clock} />
      </div>

      <CardNew
        noPad
        title={t("patients.billing.title")}
        action={
          <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={onNewInvoice}>
            {t("clinical.emptyStates.invoicesNewCta")}
          </ButtonNew>
        }
      >
        {invoices.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {t("patients.billing.empty")}
          </div>
        ) : (
          <div className={styles.tableScrollB}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>{t("patients.billing.colInvoice")}</th>
                  <th>{t("common.date")}</th>
                  <th style={{ textAlign: "right" }}>{t("patients.billing.colAmount")}</th>
                  <th style={{ textAlign: "right" }}>{t("patients.billing.colPaid")}</th>
                  <th style={{ textAlign: "right" }}>{t("patients.billing.colBalance")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("billing.billingClient.thCfdi")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const badge = invoiceStatusBadge(inv.status);
                  // Cancelar NO pone balance a 0 en BD: la columna Saldo
                  // mostraría deuda en una fila que dice "Cancelada" — se
                  // muestra "—" porque no hay nada que cobrar.
                  const voided = isVoidedInvoice(inv);
                  return (
                    <tr key={inv.id} onClick={() => onOpenInvoice(inv)} style={{ cursor: "pointer" }}>
                      <td className="mono" style={{ color: "var(--text-2)", fontWeight: 600 }}>
                        {inv.invoiceNumber}
                      </td>
                      <td className="mono" style={{ color: "var(--text-2)" }}>
                        {formatDate(inv.createdAt)}
                      </td>
                      <td className="mono" style={{ ...MONEY_CELL, color: "var(--text-1)" }}>
                        {fmtMXNdec(inv.total)}
                      </td>
                      <td className="mono" style={{ ...MONEY_CELL, color: "var(--success)" }}>
                        {fmtMXNdec(inv.paid)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          ...MONEY_CELL,
                          color: !voided && inv.balance > 0 ? "var(--warning)" : "var(--text-3)",
                        }}
                      >
                        {voided ? "—" : fmtMXNdec(inv.balance)}
                      </td>
                      <td>
                        <BadgeNew tone={badge.tone} dot>{t(badge.labelKey)}</BadgeNew>
                      </td>
                      {/* CFDI — mismo indicador que la lista de Caja: ✓ "Facturado
                          (CFDI)" si ya se timbró, "Timbrar" si el SAT está
                          configurado, o el estado neutro. */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <InvoiceCfdiBadge
                          cfdiUuid={inv.cfdiUuid}
                          facturApiEnabled={facturApiEnabled}
                          onStamp={voided ? undefined : () => onStampInvoice(inv)}
                        />
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        {isChargeableInvoice(inv) && (
                          <ButtonNew variant="ghost" size="sm" onClick={() => onChargeInvoice(inv)}>
                            {t("patients.billing.rowCharge")}
                          </ButtonNew>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>
    </div>
  );
}

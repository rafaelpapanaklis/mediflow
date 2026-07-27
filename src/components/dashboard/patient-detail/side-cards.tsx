"use client";

import Link from "next/link";
import { Receipt, Sparkles, MessageCircle, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patient-detail.module.css";

/** Cobro ya timbrado ante el SAT — se lista con ✓ "Facturado" en el card. */
export interface StampedInvoiceSummary {
  id: string;
  invoiceNumber: string;
  total: number;
}

interface SideCardsProps {
  finance: { total: number; paid: number; balance: number; credit?: number; pct: number };
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  onCharge: () => void;
  onOpenBilling: () => void; // NUEVO — abre el tab Facturación
  /**
   * ¿La sesión tiene "billing.view"? Sin el permiso el card "Estado de cuenta"
   * NO se monta (es dato de facturación, igual que la pestaña); el resto del
   * rail —reglas automáticas y WhatsApp— queda intacto.
   */
  canViewBilling?: boolean;
  /** Facturas del paciente con CFDI timbrado (canceladas excluidas). */
  stampedInvoices?: StampedInvoiceSummary[];
}

/** Máximo de cobros timbrados listados; el resto se resume en un enlace. */
const MAX_STAMPED_ROWS = 3;

export function SideCards({
  finance,
  patientId,
  patientName,
  patientPhone,
  onCharge,
  onOpenBilling,
  canViewBilling = false,
  stampedInvoices = [],
}: SideCardsProps) {
  const t = useT();
  const stampedShown = stampedInvoices.slice(0, MAX_STAMPED_ROWS);
  const stampedRest  = stampedInvoices.length - stampedShown.length;

  return (
    <aside className={styles.sidePanel} aria-label={t("patients.sideCards.panelAria")}>
      {/* Estado de cuenta — solo con permiso "billing.view" */}
      {canViewBilling && (
        <section className={styles.sideCard}>
          <header
            className={styles.sideCardHead}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
          >
            <h3 className={styles.sideCardTitle}>
              <Receipt size={13} strokeWidth={1.75} aria-hidden /> {t("patients.sideCards.accountStatement")}
            </h3>
            <button type="button" className={styles.sideCardLink} onClick={onOpenBilling}>
              {t("patients.sideCards.viewBilling")} →
            </button>
          </header>
          <div className={styles.financeRow}>
            <span>{t("patients.sideCards.treatmentTotal")}</span>
            <strong>{formatCurrency(finance.total)}</strong>
          </div>
          <div className={`${styles.financeRow} ${styles.success}`}>
            <span>{t("patients.sideCards.paid")}</span>
            <strong>{formatCurrency(finance.paid)}</strong>
          </div>
          <div className={`${styles.financeRow} ${styles.danger}`}>
            <span>{t("patients.sideCards.pendingBalance")}</span>
            <strong>{formatCurrency(finance.balance)}</strong>
          </div>
          {(finance.credit ?? 0) > 0 && (
            <div className={`${styles.financeRow} ${styles.success}`}>
              <span>{t("patients.sideCards.creditBalance")}</span>
              <strong>{formatCurrency(finance.credit ?? 0)}</strong>
            </div>
          )}
          <div className={styles.financeBar}>
            <div className={styles.financeBarFill} style={{ width: `${finance.pct}%` }} />
          </div>
          <div className={styles.financeBarLabel}>{t("patients.sideCards.pctCovered", { pct: finance.pct })}</div>

          {/* CFDI — un ✓ "Facturado" por cobro timbrado, para no tener que abrir
              la pestaña para saber cuáles ya se facturaron ante el SAT. */}
          {stampedShown.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {stampedShown.map((inv) => (
                <div key={inv.id} className={`${styles.financeRow} ${styles.success}`}>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      minWidth: 0, color: "var(--success)",
                    }}
                  >
                    <CheckCircle2 size={12} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
                    {t("patients.sideCards.invoiced")}
                    <span
                      className="mono"
                      style={{ color: "var(--text-3)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {inv.invoiceNumber}
                    </span>
                  </span>
                  <strong>{formatCurrency(inv.total)}</strong>
                </div>
              ))}
              {stampedRest > 0 && (
                <button
                  type="button"
                  className={styles.sideCardLink}
                  style={{ fontSize: 11, marginTop: 6 }}
                  onClick={onOpenBilling}
                >
                  {t("patients.sideCards.moreInvoiced", { count: stampedRest })}
                </button>
              )}
            </div>
          )}

          {finance.balance > 0 && (
            <button
              type="button"
              className={`${styles.sideBtn} ${styles.primary} ${styles.fullWidth}`}
              onClick={onCharge}
            >
              {t("patients.sideCards.chargeNow")} · {formatCurrency(finance.balance)}
            </button>
          )}
        </section>
      )}

      {/* Reglas automáticas */}
      <section className={`${styles.sideCard} ${styles.aiCard}`}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Sparkles size={13} strokeWidth={1.75} aria-hidden /> {t("patients.sideCards.autoRules")}
          </h3>
        </header>
        <p className={styles.aiText}>
          {t("patients.sideCards.reminderText", { name: patientName.split(" ")[0] ?? "" })}
        </p>
      </section>

      {/* WhatsApp recientes */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <MessageCircle size={13} strokeWidth={1.75} aria-hidden /> {t("patients.sideCards.recentWhatsApp")}
          </h3>
        </header>
        <div className={styles.waEmpty}>
          {patientPhone ? (
            <>{t("patients.sideCards.noRecentMessages", { name: patientName.split(" ")[0] ?? "" })}</>
          ) : (
            <>{t("patients.sideCards.noPhone")}</>
          )}
        </div>
        {patientPhone && (
          <Link
            href={`/dashboard/inbox?patientId=${encodeURIComponent(patientId)}`}
            className={`${styles.sideBtn} ${styles.fullWidth}`}
            style={{ textDecoration: "none" }}
          >
            {t("patients.sideCards.openChat")}
          </Link>
        )}
      </section>
    </aside>
  );
}

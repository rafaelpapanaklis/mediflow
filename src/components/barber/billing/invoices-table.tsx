"use client";

import { AlertTriangle } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { formatBarberCents, formatBarberDate, invoiceStatusKey, type BarberInvoiceSummary } from "./shared";

const STATUS_LABEL_KEY: Record<ReturnType<typeof invoiceStatusKey>, string> = {
  paid: "statusPaid",
  open: "statusOpen",
  failed: "statusFailed",
  void: "statusVoid",
  uncollectible: "statusUncollectible",
  draft: "statusDraft",
};

const STATUS_TONE: Record<ReturnType<typeof invoiceStatusKey>, "ok" | "warn" | "danger" | "neutral"> = {
  paid: "ok",
  open: "warn",
  failed: "danger",
  void: "neutral",
  uncollectible: "danger",
  draft: "neutral",
};

/**
 * Facturas de la suscripción (leídas de Stripe) con los COBROS RECHAZADOS
 * arriba y visibles: intentos, próximo reintento, motivo y enlace para pagar.
 * En el dental una falla de cobro era invisible; aquí no.
 */
export function InvoicesTable({
  t,
  locale,
  invoices,
  failed,
}: {
  t: TFunction;
  locale: string;
  invoices: BarberInvoiceSummary[];
  failed: BarberInvoiceSummary[];
}) {
  return (
    <section className="dcbb-card" aria-labelledby="dcbb-invoices-title">
      <h2 id="dcbb-invoices-title" className="dcbb-section-title">{t("barber.suscripcion.invoices.title")}</h2>

      {failed.length > 0 && (
        <div className="dcbb-alert dcbb-alert--danger" style={{ marginBottom: 14 }}>
          <AlertTriangle size={18} className="dcbb-alert__icon" aria-hidden />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="dcbb-alert__title">{t("barber.suscripcion.invoices.failedTitle")}</p>
            <p className="dcbb-alert__body">{t("barber.suscripcion.invoices.failedBody")}</p>
            <ul className="dcbb-modal__lines" style={{ marginTop: 8 }}>
              {failed.map((inv) => (
                <li key={inv.id} className="dcbb-modal__line" style={{ flexWrap: "wrap" }}>
                  <span>
                    {formatBarberDate(inv.createdAt, locale)} · {formatBarberCents(inv.amountDueCents, inv.currency, locale)} ·{" "}
                    {t("barber.suscripcion.invoices.attempts", { count: inv.attemptCount })}
                    {inv.failureMessage ? ` · ${t("barber.suscripcion.invoices.reason", { reason: inv.failureMessage })}` : ""}
                    {inv.nextPaymentAttemptAt
                      ? ` · ${t("barber.suscripcion.invoices.nextAttempt", { date: formatBarberDate(inv.nextPaymentAttemptAt, locale) })}`
                      : ""}
                  </span>
                  {inv.hostedInvoiceUrl && (
                    <a className="dcbb-link" href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                      {t("barber.suscripcion.invoices.pay")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <p className="dcbb-fact__hint" style={{ margin: 0 }}>{t("barber.suscripcion.invoices.empty")}</p>
      ) : (
        <div className="dcbb-table-wrap">
          <table className="dcbb-table">
            <thead>
              <tr>
                <th scope="col">{t("barber.suscripcion.invoices.date")}</th>
                <th scope="col">{t("barber.suscripcion.invoices.number")}</th>
                <th scope="col">{t("barber.suscripcion.invoices.amount")}</th>
                <th scope="col">{t("barber.suscripcion.invoices.status")}</th>
                <th scope="col"><span className="sr-only">{t("barber.suscripcion.invoices.view")}</span></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const key = invoiceStatusKey(inv);
                const amount = inv.status === "paid" ? inv.amountPaidCents : inv.amountDueCents;
                return (
                  <tr key={inv.id}>
                    <td>{formatBarberDate(inv.createdAt, locale)}</td>
                    <td>
                      {inv.number ?? inv.id.slice(-8)}
                      {key === "failed" && (
                        <div className="dcbb-table__muted">
                          {t("barber.suscripcion.invoices.attempts", { count: inv.attemptCount })}
                        </div>
                      )}
                    </td>
                    <td>{formatBarberCents(amount, inv.currency, locale)}</td>
                    <td>
                      <span className={`dcbb-badge dcbb-badge--${STATUS_TONE[key]}`}>
                        {t(`barber.suscripcion.invoices.${STATUS_LABEL_KEY[key]}`)}
                      </span>
                    </td>
                    <td>
                      <div className="dcbb-table__links">
                        {inv.hostedInvoiceUrl && (
                          <a className="dcbb-link" href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                            {key === "open" || key === "failed"
                              ? t("barber.suscripcion.invoices.pay")
                              : t("barber.suscripcion.invoices.view")}
                          </a>
                        )}
                        {inv.invoicePdf && (
                          <a className="dcbb-link" href={inv.invoicePdf} target="_blank" rel="noopener noreferrer">
                            {t("barber.suscripcion.invoices.pdf")}
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
    </section>
  );
}

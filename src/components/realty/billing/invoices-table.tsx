"use client";

import type { TFunction } from "@/i18n/t";
import {
  formatCentsMXN,
  invoiceStatusKey,
  shortDate,
  type RealtyInvoiceDTO,
} from "./shared";

/**
 * Historial de pagos de la SUSCRIPCIÓN. Se lee de Stripe en vivo (este
 * vertical no guarda una tabla de facturas propia), así que cuando Stripe no
 * responde la pantalla lo DICE en vez de enseñar una lista vacía que parece
 * "nunca has pagado".
 */
export function RealtyInvoicesTable({
  t,
  invoices,
  unavailable,
  locale,
}: {
  t: TFunction;
  invoices: RealtyInvoiceDTO[];
  unavailable: boolean;
  locale: string;
}) {
  const dateLocale = locale === "en" ? "en-US" : "es-MX";

  return (
    <section className="dcrb-card">
      <header className="dcrb-cardhead">
        <h2 className="dcrb-cardtitle">{t("invoices.title")}</h2>
        <p className="dcrb-cardhint">{t("invoices.hint")}</p>
      </header>

      {unavailable ? (
        <p className="dcrb-empty">{t("invoices.unavailable")}</p>
      ) : invoices.length === 0 ? (
        <p className="dcrb-empty">{t("invoices.empty")}</p>
      ) : (
        <div className="dcrb-tablewrap">
          <table className="dcrb-table">
            <thead>
              <tr>
                <th>{t("invoices.date")}</th>
                <th>{t("invoices.number")}</th>
                <th className="dcrb-num">{t("invoices.amount")}</th>
                <th>{t("invoices.status")}</th>
                <th aria-label={t("invoices.view")} />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="dcrb-num">{shortDate(inv.createdAt, dateLocale)}</td>
                  <td>{inv.number ?? "—"}</td>
                  <td className="dcrb-num">
                    {formatCentsMXN(inv.amountCents, inv.currency)}
                  </td>
                  <td>
                    {t(`invoices.${invoiceStatusKey(inv.status)}`)}
                    {inv.failureReason ? (
                      <span className="dcrb-fail">{t("invoices.failed")}</span>
                    ) : null}
                  </td>
                  <td>
                    {inv.hostedUrl ? (
                      <a
                        className="dcrb-link"
                        href={inv.hostedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("invoices.view")}
                      </a>
                    ) : inv.pdfUrl ? (
                      <a
                        className="dcrb-link"
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("invoices.pdf")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

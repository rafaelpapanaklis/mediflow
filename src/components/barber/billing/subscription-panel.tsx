"use client";

import { CreditCard, Loader2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  billingStatusKey,
  billingStatusTone,
  formatBarberDate,
  formatCardExpiry,
  type BarberBillingSummary,
  type BarberGateDTO,
} from "./shared";

/**
 * Estado de la suscripción: plan y ciclo, renovación/fin, tarjeta, y las
 * acciones (actualizar tarjeta vía portal, cancelar/reanudar, pagar factura
 * pendiente). El estado que manda es el de la BD (gate.subscriptionStatus):
 * es el que abre o cierra el panel. Stripe aporta fechas, tarjeta y la
 * cancelación programada.
 */
export function SubscriptionPanel({
  t,
  locale,
  gate,
  summary,
  canManage,
  busy,
  onPortal,
  onCancel,
  onResume,
}: {
  t: TFunction;
  locale: string;
  gate: BarberGateDTO;
  summary: BarberBillingSummary;
  canManage: boolean;
  busy: string | null;
  onPortal: () => void;
  onCancel: () => void;
  onResume: () => void;
}) {
  const sub = summary.subscription;
  const statusKey = billingStatusKey(gate.subscriptionStatus);
  const tone = billingStatusTone(statusKey);
  const live = sub?.live === true;
  const card = sub?.paymentMethod ?? null;

  const dateLine = (() => {
    if (!sub?.currentPeriodEndAt) return null;
    const date = formatBarberDate(sub.currentPeriodEndAt, locale);
    if (sub.cancelAtPeriodEnd) return t("barber.suscripcion.hero.cancelScheduled", { date });
    if (statusKey === "active" || statusKey === "trialing") return t("barber.suscripcion.hero.renewsOn", { date });
    return t("barber.suscripcion.hero.endsOn", { date });
  })();

  return (
    <section className="dcbb-card" aria-labelledby="dcbb-sub-title">
      <div className="dcbb-chips" style={{ marginBottom: 14 }}>
        <h2 id="dcbb-sub-title" className="dcbb-section-title" style={{ margin: 0 }}>
          {t("barber.suscripcion.hero.currentPlan")}
        </h2>
        <span className="dcbb-chip-plan">{gate.planName}</span>
        <span className={`dcbb-badge dcbb-badge--${tone}`}>{t(`barber.suscripcion.status.${statusKey}`)}</span>
      </div>

      <div className="dcbb-facts">
        <div className="dcbb-fact">
          <span className="dcbb-kicker">{t("barber.suscripcion.plans.title")}</span>
          <span className="dcbb-fact__value">{gate.planName}</span>
          {sub && (
            <span className="dcbb-fact__hint">
              {t(sub.interval === "year" ? "barber.suscripcion.hero.intervalYear" : "barber.suscripcion.hero.intervalMonth")}
            </span>
          )}
        </div>
        <div className="dcbb-fact">
          <span className="dcbb-kicker">{t("barber.suscripcion.invoices.date")}</span>
          <span className="dcbb-fact__value">{dateLine ?? "—"}</span>
          {sub?.cancelAtPeriodEnd && (
            <span className="dcbb-fact__hint">{t("barber.suscripcion.status.canceled")}</span>
          )}
        </div>
        <div className="dcbb-fact">
          <span className="dcbb-kicker">
            <CreditCard size={12} aria-hidden style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
            {t("barber.suscripcion.hero.manageCard")}
          </span>
          <span className="dcbb-fact__value">
            {card
              ? t("barber.suscripcion.hero.card", {
                  brand: card.brand.toUpperCase(),
                  last4: card.last4,
                  exp: formatCardExpiry(card.expMonth, card.expYear),
                })
              : t("barber.suscripcion.hero.noCard")}
          </span>
        </div>
      </div>

      {summary.stripeError && (
        <p className="dcbb-fact__hint" style={{ marginTop: 12 }}>{t("barber.suscripcion.hero.stripeError")}</p>
      )}
      {!canManage && (
        <p className="dcbb-fact__hint" style={{ marginTop: 12 }}>{t("barber.suscripcion.hero.onlyOwner")}</p>
      )}

      {canManage && summary.configured && (sub || summary.invoices.length > 0) && (
        <div className="dcbb-actions">
          {sub?.openInvoiceUrl && (
            <a className="dcbb-btn barber-btn-primary" href={sub.openInvoiceUrl} target="_blank" rel="noopener noreferrer">
              {t("barber.suscripcion.hero.payOpenInvoice")}
            </a>
          )}
          <button type="button" className="dcbb-btn" disabled={busy !== null} onClick={onPortal}>
            {busy === "portal" ? <Loader2 size={15} className="dcbb-spin" aria-hidden /> : <CreditCard size={15} aria-hidden />}
            {t("barber.suscripcion.hero.manageCard")}
          </button>
          {live && !sub?.cancelAtPeriodEnd && (
            <button type="button" className="dcbb-btn dcbb-btn--danger" disabled={busy !== null} onClick={onCancel}>
              {t("barber.suscripcion.hero.cancel")}
            </button>
          )}
          {live && sub?.cancelAtPeriodEnd && (
            <button type="button" className="dcbb-btn" disabled={busy !== null} onClick={onResume}>
              {busy === "resume" ? <Loader2 size={15} className="dcbb-spin" aria-hidden /> : null}
              {t("barber.suscripcion.hero.resume")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

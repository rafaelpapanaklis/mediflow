"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { isBarberUnlimited } from "@/lib/barber/plan-shared";
import {
  formatBarberCents,
  yearlyToMonthlyCents,
  type BarberBillingIntervalUI,
  type BarberPlanCardDTO,
} from "./shared";

/**
 * Tarjetas de planes. TODO lo que se pinta (nombre, precios, límites, cupo,
 * features) viene de barber_plan_configs vía el DTO — aquí no hay números.
 *
 *  · Sin suscripción viva → "Contratar" (mensual o anual, si el plan lo tiene).
 *  · Con suscripción viva → "Cambiar a este plan" en el ciclo de la suscripción
 *    (el cambio conserva el ciclo; el selector se bloquea en ese ciclo).
 */
export function PlanCards({
  t,
  locale,
  plans,
  currentPlanId,
  canManage,
  configured,
  hasLiveSubscription,
  lockedInterval,
  busyPlan,
  onContract,
  onChange,
}: {
  t: TFunction;
  locale: string;
  plans: BarberPlanCardDTO[];
  currentPlanId: string;
  canManage: boolean;
  configured: boolean;
  hasLiveSubscription: boolean;
  lockedInterval: BarberBillingIntervalUI | null;
  busyPlan: string | null;
  onContract: (planId: BarberPlanCardDTO["id"], interval: BarberBillingIntervalUI) => void;
  onChange: (plan: BarberPlanCardDTO) => void;
}) {
  const anyYearly = plans.some((p) => p.priceYearlyCents !== null);
  const [cycle, setCycle] = useState<BarberBillingIntervalUI>(lockedInterval ?? "month");
  const interval: BarberBillingIntervalUI = lockedInterval ?? cycle;

  function featureLabel(key: string): string {
    const label = t(`barber.suscripcion.features.${key}`);
    return label.endsWith(`.${key}`) ? key : label;
  }

  function limitLine(key: "barbers" | "branches", max: number): string {
    if (isBarberUnlimited(max)) return t(`barber.suscripcion.limits.${key}.unlimited`);
    return t(`barber.suscripcion.limits.${key}.count`, { count: max });
  }

  function messagesLine(quota: number): string {
    if (isBarberUnlimited(quota)) return t("barber.suscripcion.plans.messagesUnlimited");
    return t("barber.suscripcion.plans.messages", { count: quota });
  }

  return (
    <section aria-labelledby="dcbb-plans-title">
      <div className="dcbb-plans-head">
        <h2 id="dcbb-plans-title" className="dcbb-section-title" style={{ margin: 0 }}>
          {t("barber.suscripcion.plans.title")}
        </h2>
        {anyYearly && !lockedInterval && (
          <div className="dcbb-toggle" role="group" aria-label={t("barber.suscripcion.plans.title")}>
            <button
              type="button"
              className="dcbb-toggle__btn"
              aria-pressed={interval === "month"}
              onClick={() => setCycle("month")}
            >
              {t("barber.suscripcion.plans.monthly")}
            </button>
            <button
              type="button"
              className="dcbb-toggle__btn"
              aria-pressed={interval === "year"}
              onClick={() => setCycle("year")}
            >
              {t("barber.suscripcion.plans.yearly")}
            </button>
          </div>
        )}
        {lockedInterval && (
          <span className="dcbb-fact__hint">
            {t(
              lockedInterval === "year"
                ? "barber.suscripcion.plans.lockedIntervalYear"
                : "barber.suscripcion.plans.lockedIntervalMonth",
            )}
          </span>
        )}
      </div>

      <div className="dcbb-plans">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const yearly = interval === "year";
          const cents = yearly ? plan.priceYearlyCents : plan.priceMonthlyCents;
          const hasPrice = cents !== null;
          const showPromo =
            !yearly && !hasLiveSubscription && plan.firstMonthCents !== null && plan.firstMonthCents < plan.priceMonthlyCents;
          const busy = busyPlan === plan.id;
          const disabled = !canManage || !configured || !plan.isActive || !hasPrice || busy || (isCurrent && hasLiveSubscription);
          const cta = isCurrent && hasLiveSubscription
            ? t("barber.suscripcion.plans.current")
            : hasLiveSubscription
              ? t("barber.suscripcion.plans.change")
              : t("barber.suscripcion.plans.contract");

          return (
            <article key={plan.id} className={`dcbb-plan ${isCurrent ? "dcbb-plan--current" : ""}`}>
              <div className="dcbb-plan__head">
                <h3 className="dcbb-plan__name">{plan.name}</h3>
                {isCurrent && <span className="dcbb-plan__current">{t("barber.suscripcion.plans.current")}</span>}
              </div>

              <div className="dcbb-plan__price">
                <span className="dcbb-plan__amount">
                  {hasPrice ? formatBarberCents(cents as number, "MXN", locale) : "—"}
                </span>
                <span className="dcbb-plan__per">
                  {hasPrice
                    ? t(yearly ? "barber.suscripcion.plans.perYear" : "barber.suscripcion.plans.perMonth")
                    : t("barber.suscripcion.plans.noYearly")}
                </span>
              </div>
              {yearly && hasPrice && (
                <div className="dcbb-plan__sub">
                  {t("barber.suscripcion.plans.yearlyEquivalent", {
                    amount: formatBarberCents(yearlyToMonthlyCents(cents as number), "MXN", locale),
                  })}
                </div>
              )}
              {showPromo && (
                <span className="dcbb-plan__promo">
                  {t("barber.suscripcion.plans.firstMonth", {
                    amount: formatBarberCents(plan.firstMonthCents as number, "MXN", locale),
                  })}
                </span>
              )}

              <div className="dcbb-kicker">{t("barber.suscripcion.plans.includes")}</div>
              <ul className="dcbb-plan__list">
                <li className="dcbb-plan__item">
                  <span aria-hidden="true" className="dcbb-plan__check">✓</span>
                  {limitLine("barbers", plan.maxBarbers)}
                </li>
                <li className="dcbb-plan__item">
                  <span aria-hidden="true" className="dcbb-plan__check">✓</span>
                  {limitLine("branches", plan.maxBranches)}
                </li>
                <li className="dcbb-plan__item">
                  <span aria-hidden="true" className="dcbb-plan__check">✓</span>
                  {messagesLine(plan.messageQuota)}
                </li>
                {plan.features.map((key) => (
                  <li key={key} className="dcbb-plan__item">
                    <span aria-hidden="true" className="dcbb-plan__check">✓</span>
                    {featureLabel(key)}
                  </li>
                ))}
              </ul>

              <div className="dcbb-plan__cta">
                <button
                  type="button"
                  className={`dcbb-btn dcbb-btn--block ${isCurrent && hasLiveSubscription ? "" : "barber-btn-primary"}`}
                  disabled={disabled}
                  onClick={() => (hasLiveSubscription ? onChange(plan) : onContract(plan.id, interval))}
                >
                  {busy ? <Loader2 size={15} className="dcbb-spin" aria-hidden /> : null}
                  {busy ? t("barber.suscripcion.plans.working") : cta}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

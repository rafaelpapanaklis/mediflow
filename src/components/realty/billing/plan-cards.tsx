"use client";

import { Check } from "lucide-react";
import {
  formatRealtyLimit,
  formatRealtyStorage,
  isRealtyUnlimited,
  realtyPlanRank,
  type RealtyPlanId,
} from "@/lib/realty/plan-shared";
import type { TFunction } from "@/i18n/t";
import { formatCentsMXN, type RealtyPlanCardDTO } from "./shared";

/**
 * Comparación de planes. TODO precio y TODO límite entra por props desde
 * `realty_plan_configs`: aquí no hay ni un número escrito a mano.
 *
 * Cada tarjeta enseña lo que AÑADE sobre la anterior, no las 21 features
 * repetidas tres veces — así se ve de un vistazo qué se gana al subir.
 */
export function RealtyPlanCards({
  t,
  plans,
  currentPlanId,
  canManage,
  busy,
  hasSubscription,
  onPick,
}: {
  t: TFunction;
  plans: RealtyPlanCardDTO[];
  currentPlanId: RealtyPlanId;
  canManage: boolean;
  busy: boolean;
  /** Sin suscripción viva, el botón CONTRATA; con ella, CAMBIA de plan. */
  hasSubscription: boolean;
  onPick: (plan: RealtyPlanCardDTO) => void;
}) {
  const active = plans.filter((p) => p.isActive);

  return (
    <div className="dcrb-plans">
      {active.map((plan, index) => {
        const previous = index > 0 ? active[index - 1] : null;
        const shown = previous
          ? plan.features.filter((f) => !previous.features.includes(f))
          : plan.features;
        const isCurrent = plan.id === currentPlanId;

        const usersLine = isRealtyUnlimited(plan.maxUsers)
          ? t("plans.limitUsersUnlimited")
          : t("plans.limitUsers", { count: plan.maxUsers });
        const officesLine = isRealtyUnlimited(plan.maxOffices)
          ? t("plans.limitOfficesUnlimited")
          : t("plans.limitOffices", { count: plan.maxOffices });
        const propertiesLine = isRealtyUnlimited(plan.maxProperties)
          ? t("plans.limitProperties")
          : `${plan.maxProperties} ${t("usage.properties")}`;
        const storageLine = t("plans.limitStorage", {
          size: formatRealtyStorage(plan.storageQuotaMb),
        });
        const messagesLine =
          plan.messageQuota === 0
            ? t("plans.noMessages")
            : isRealtyUnlimited(plan.messageQuota)
              ? formatRealtyLimit(plan.messageQuota, "mensaje", "mensajes")
              : t("plans.limitMessages", { count: plan.messageQuota });

        return (
          <article
            key={plan.id}
            className={`dcrb-plan${isCurrent ? " dcrb-plan--current" : ""}`}
          >
            <div>
              <div className="dcrb-plan__name">{plan.name}</div>
              <div className="dcrb-plan__price">
                <span className="dcrb-plan__amount">
                  {formatCentsMXN(plan.priceMonthlyCents)}
                </span>
                <span className="dcrb-plan__per">{t("account.perMonth")}</span>
              </div>
            </div>

            <div className="dcrb-plan__limits">
              <span>{usersLine}</span>
              <span>{officesLine}</span>
              <span>{propertiesLine}</span>
              <span>{storageLine}</span>
              <span>{messagesLine}</span>
            </div>

            <div>
              <div className="dcrb-cardhint" style={{ marginBottom: 6 }}>
                {previous
                  ? t("plans.everythingIn", { plan: previous.name })
                  : t("plans.includes")}
              </div>
              <ul className="dcrb-plan__features">
                {shown.map((key) => (
                  <li key={key}>
                    <Check size={13} className="dcrb-plan__check" aria-hidden />
                    <span>{t(`features.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="dcrb-plan__foot">
              {isCurrent ? (
                <button type="button" className="dcrb-btn dcrb-btn--ghost" disabled>
                  {t("plans.current")}
                </button>
              ) : (
                <button
                  type="button"
                  className="dcrb-btn dcrb-btn--primary"
                  disabled={!canManage || busy}
                  onClick={() => onPick(plan)}
                >
                  {/* Sin suscripción esto CONTRATA por primera vez: decir
                      "cambiar" sería mentir sobre lo que va a pasar. */}
                  {!hasSubscription
                    ? t("plans.choose", { plan: plan.name })
                    : realtyPlanRank(plan.id) < realtyPlanRank(currentPlanId)
                      ? t("plans.downgrade", { plan: plan.name })
                      : t("plans.upgrade", { plan: plan.name })}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

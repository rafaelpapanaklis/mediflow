import { MessageCircle } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { BarberResolvedPlan } from "@/lib/barber/plan-shared";
import {
  BARBER_LANDING_ANCHORS,
  BARBER_LANDING_WA_POINTS,
  activeBarberPlans,
  barberPlanRequiredFor,
  formatUsd,
  isBarberQuotaUnlimited,
  type BarberReminderCostEstimate,
} from "@/lib/barber/marketing";
import { LandingIcon } from "./icons";

/**
 * La banda del diferenciador. El costo que se enseña NO es nuestro: es lo
 * que Meta le cobra a la cuenta de la barbería, calculado con la misma
 * constante que usa el panel (BARBER_WA_PRICE_USD), y los cupos por plan
 * salen de la tabla.
 */
export function BarberWhatsappBand({
  t,
  plans,
  cost,
}: {
  t: TFunction;
  plans: BarberResolvedPlan[];
  cost: BarberReminderCostEstimate;
}) {
  const active = activeBarberPlans(plans);
  return (
    <section className="dcbl-section dcbl-wa dcbl-dark" id={BARBER_LANDING_ANCHORS.whatsapp}>
      <div className="dcbl-wrap">
        <div className="dcbl-wa__grid">
          <div>
            <span className="dcbl-eyebrow">{t("whatsapp.eyebrow")}</span>
            <h2 className="dcbl-h2">{t("whatsapp.title")}</h2>
            <p className="dcbl-lead">{t("whatsapp.body")}</p>
            <ul className="dcbl-wa__points" style={{ marginTop: 24 }}>
              {BARBER_LANDING_WA_POINTS.map((p) => {
                const requiredPlan = barberPlanRequiredFor(plans, p.feature);
                return (
                  <li key={p.key}>
                    <LandingIcon name={p.icon} size={18} />
                    <div className="dcbl-wa__point-text">
                      <span className="dcbl-wa__point-title">{t(`whatsapp.points.${p.key}.title`)}</span>
                      <span className="dcbl-wa__point-body">{t(`whatsapp.points.${p.key}.body`)}</span>
                      {requiredPlan ? (
                        <span className="dcbl-badge dcbl-badge--dark">
                          {t("features.from", { plan: requiredPlan.name })}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="dcbl-cost" aria-labelledby="dcbl-cost-title">
            <h3 id="dcbl-cost-title" className="dcbl-cost__title">
              {t("whatsapp.cost.title")}
            </h3>
            <p className="dcbl-cost__meta">{t("whatsapp.cost.ours")}</p>
            <ul className="dcbl-cost__quotas">
              {active.map((p) => (
                <li key={p.id}>
                  <MessageCircle size={16} aria-hidden="true" />
                  <span>
                    {isBarberQuotaUnlimited(p.messageQuota)
                      ? t("whatsapp.cost.quotaUnlimited", { plan: p.name })
                      : t("whatsapp.cost.quota", { plan: p.name, count: p.messageQuota })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="dcbl-cost__meta">
              {t("whatsapp.cost.meta", { usd: formatUsd(cost.perMessageUsd) })}
            </p>
            <p className="dcbl-cost__example">
              {t("whatsapp.cost.example", {
                visits: cost.visits,
                usdTotal: formatUsd(cost.usd),
                mxn: cost.mxn,
              })}
            </p>
            <p className="dcbl-cost__connect">{t("whatsapp.cost.connect")}</p>
          </aside>
        </div>
      </div>
    </section>
  );
}

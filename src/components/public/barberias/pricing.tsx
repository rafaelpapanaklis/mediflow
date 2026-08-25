import Link from "next/link";
import { Check, MessageCircle, Scissors, Store } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { barberFeatureLabel, isBarberUnlimited } from "@/lib/barber/plan-shared";
import {
  BARBER_LANDING_ANCHORS,
  BARBER_REGISTER_PATH,
  type BarberPlanCardVM,
} from "@/lib/barber/marketing";

/**
 * Los tres planes, tal cual la tabla: precio, primer mes y anual (solo si
 * la fila los trae), límites y features. El texto de cada feature vive en
 * el diccionario (pricing.features.<key>); si una llave nueva del catálogo
 * todavía no tiene texto, se pinta la etiqueta del catálogo y no la llave.
 */
function featureText(t: TFunction, key: string): string {
  const k = `pricing.features.${key}`;
  const out = t(k);
  // makeBarberT devuelve la llave COMPLETA (con prefijo) cuando no resuelve.
  return out === k || out.endsWith(`.${k}`) ? barberFeatureLabel(key) : out;
}

function LimitRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li>
      {icon}
      <span>{text}</span>
    </li>
  );
}

export function BarberPricing({ t, cards }: { t: TFunction; cards: BarberPlanCardVM[] }) {
  return (
    <section className="dcbl-section" id={BARBER_LANDING_ANCHORS.pricing}>
      <div className="dcbl-wrap">
        <div className="dcbl-head dcbl-head--center">
          <span className="dcbl-eyebrow">{t("pricing.eyebrow")}</span>
          <h2 className="dcbl-h2">{t("pricing.title")}</h2>
          <p className="dcbl-lead">{t("pricing.sub")}</p>
        </div>

        <div className="dcbl-plans">
          {cards.map((c) => {
            const list = c.previousPlanName ? c.addedFeatureKeys : c.featureKeys;
            return (
              <article
                key={c.id}
                className={`dcbl-plan${c.recommended ? " dcbl-plan--recommended" : ""}`}
                aria-labelledby={`dcbl-plan-${c.id}`}
              >
                {c.recommended ? <span className="dcbl-plan__flag">{t("pricing.recommended")}</span> : null}
                <h3 id={`dcbl-plan-${c.id}`} className="dcbl-plan__name">
                  {c.name}
                </h3>
                <div>
                  <div className="dcbl-plan__price">
                    <span className="dcbl-plan__amount">{c.monthlyLabel}</span>
                    <span className="dcbl-plan__per">{t("pricing.perMonth")}</span>
                  </div>
                  {c.firstMonthLabel ? (
                    <p className="dcbl-plan__promo">{t("pricing.firstMonth", { price: c.firstMonthLabel })}</p>
                  ) : null}
                  {c.yearlyLabel && c.yearlyPerMonthLabel ? (
                    <p className="dcbl-plan__yearly">
                      {t("pricing.yearly", { price: c.yearlyLabel, perMonth: c.yearlyPerMonthLabel })}
                    </p>
                  ) : null}
                </div>
                <Link
                  href={BARBER_REGISTER_PATH}
                  className={`dcbl-btn dcbl-btn--block ${c.recommended ? "dcbl-btn--primary" : "dcbl-btn--light"}`}
                >
                  {t("pricing.cta", { plan: c.name })}
                </Link>

                <ul className="dcbl-plan__limits" aria-label={t("pricing.includes")}>
                  <LimitRow
                    icon={<Scissors size={16} aria-hidden="true" />}
                    text={
                      isBarberUnlimited(c.maxBarbers)
                        ? t("pricing.limits.barbersUnlimited")
                        : t("pricing.limits.barbers", { count: c.maxBarbers })
                    }
                  />
                  <LimitRow
                    icon={<Store size={16} aria-hidden="true" />}
                    text={
                      isBarberUnlimited(c.maxBranches)
                        ? t("pricing.limits.branchesUnlimited")
                        : t("pricing.limits.branches", { count: c.maxBranches })
                    }
                  />
                  <LimitRow
                    icon={<MessageCircle size={16} aria-hidden="true" />}
                    text={
                      isBarberUnlimited(c.messageQuota)
                        ? t("pricing.limits.messagesUnlimited")
                        : t("pricing.limits.messages", { count: c.messageQuota })
                    }
                  />
                </ul>

                {c.previousPlanName ? (
                  <p className="dcbl-plan__plus">{t("pricing.plus", { plan: c.previousPlanName })}</p>
                ) : (
                  <p className="dcbl-plan__plus">{t("pricing.includes")}</p>
                )}
                <ul className="dcbl-plan__features">
                  {list.map((k) => (
                    <li key={k}>
                      <Check size={15} aria-hidden="true" />
                      <span>{featureText(t, k)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>

        <div className="dcbl-nofees">
          <h3 className="dcbl-nofees__title">{t("pricing.noFees.title")}</h3>
          <ul style={{ display: "contents" }}>
            {["cita", "cliente", "cobro", "cancel"].map((k) => (
              <li key={k}>
                <Check size={16} aria-hidden="true" />
                <span>{t(`pricing.noFees.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="dcbl-footnote">{t("pricing.footnote")}</p>
      </div>
    </section>
  );
}

"use client";

import type { TFunction } from "@/i18n/t";
import { formatLimitValue, usageTone, type RealtyLimitDTO } from "./shared";

/**
 * Medidores de consumo contra el cupo del plan.
 *
 * Honestidad: al 90 % se AVISA y al 100 % se dice que está agotado — pero
 * nada se esconde ni se borra. Si un cupo es 0 (el plan no lo incluye) se
 * dice eso, no "0 de 0".
 */
export function RealtyUsagePanel({
  t,
  limits,
}: {
  t: TFunction;
  limits: RealtyLimitDTO[];
}) {
  return (
    <section className="dcrb-card">
      <header className="dcrb-cardhead">
        <h2 className="dcrb-cardtitle">{t("usage.title")}</h2>
        <p className="dcrb-cardhint">{t("usage.hint")}</p>
      </header>

      <div className="dcrb-meters">
        {limits.map((limit) => {
          const tone = usageTone(limit);
          const notIncluded = !limit.unlimited && limit.limit === 0;
          const width = limit.unlimited ? 0 : Math.min(100, limit.percent);

          return (
            <div key={limit.key}>
              <div className="dcrb-meter__top">
                <span className="dcrb-meter__name">{t(`usage.${limit.key}`)}</span>
                <span className="dcrb-meter__num">
                  {notIncluded
                    ? t("usage.notIncluded")
                    : limit.unlimited
                      ? t("usage.unlimited", {
                          used: formatLimitValue(limit.key, limit.used),
                        })
                      : t("usage.ofLimit", {
                          used: formatLimitValue(limit.key, limit.used),
                          limit: formatLimitValue(limit.key, limit.limit),
                        })}
                </span>
              </div>

              <div
                className="dcrb-meter__track"
                role="progressbar"
                aria-valuenow={limit.unlimited ? 0 : Math.min(100, limit.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t(`usage.${limit.key}`)}
              >
                <div
                  className={`dcrb-meter__fill${
                    tone === "danger"
                      ? " dcrb-meter__fill--danger"
                      : tone === "warning"
                        ? " dcrb-meter__fill--warning"
                        : ""
                  }`}
                  style={{ width: `${width}%` }}
                />
              </div>

              {!notIncluded && limit.atLimit ? (
                <p className="dcrb-meter__note dcrb-meter__note--danger">
                  {t("usage.full")}
                </p>
              ) : !notIncluded && limit.nearLimit ? (
                <p className="dcrb-meter__note dcrb-meter__note--warning">
                  {t("usage.near", { percent: limit.percent })}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

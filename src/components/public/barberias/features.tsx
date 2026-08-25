import type { TFunction } from "@/i18n/t";
import type { BarberResolvedPlan } from "@/lib/barber/plan-shared";
import {
  BARBER_LANDING_ANCHORS,
  BARBER_LANDING_GROUPS,
  BARBER_LANDING_LOYALTY_GOAL,
  BARBER_WEB_TEMPLATE_COUNT,
  barberPlanRequiredFor,
} from "@/lib/barber/marketing";
import { LandingIcon } from "./icons";
import { rd } from "./problem";

/**
 * Lo que hace, agrupado por lo que le importa al dueño. La etiqueta
 * "Desde <plan>" de cada promesa sale de la TABLA de planes (qué feature
 * trae cada fila), no de una lista escrita a mano; y no se pinta cuando la
 * feature ya viene en el plan más barato.
 *
 * Cada grupo va numerado como un apartado de la carta de servicios y, en
 * escritorio, su cabecera se queda pegada mientras se recorren sus tarjetas.
 */
export function BarberFeatures({ t, plans }: { t: TFunction; plans: BarberResolvedPlan[] }) {
  const advanced = barberPlanRequiredFor(plans, "advancedRoles");
  const vars = { count: BARBER_WEB_TEMPLATE_COUNT, goal: BARBER_LANDING_LOYALTY_GOAL };

  return (
    <section className="dcbl-section dcbl-features" id={BARBER_LANDING_ANCHORS.features}>
      <div className="dcbl-wrap">
        <div className="dcbl-head" data-reveal="">
          <span className="dcbl-eyebrow">{t("features.eyebrow")}</span>
          <h2 className="dcbl-h2">{t("features.title")}</h2>
          <p className="dcbl-lead">{t("features.sub")}</p>
        </div>

        {BARBER_LANDING_GROUPS.map((group, gi) => (
          <div key={group.key} className="dcbl-group">
            <div className="dcbl-group__head" data-reveal="">
              <span className="dcbl-group__num" aria-hidden="true">
                {String(gi + 1).padStart(2, "0")}
              </span>
              <span className="dcbl-group__icon">
                <LandingIcon name={group.icon} size={20} />
              </span>
              <h3 className="dcbl-h3">{t(`features.groups.${group.key}.title`)}</h3>
              <p className="dcbl-group__sub">{t(`features.groups.${group.key}.sub`)}</p>
            </div>
            <ul className="dcbl-group__grid">
              {group.items.map((item, i) => {
                const base = `features.groups.${group.key}.items.${item.key}`;
                const requiredPlan = barberPlanRequiredFor(plans, item.feature);
                const rolesExtra =
                  group.key === "barbero" && item.key === "roles" && advanced
                    ? ` ${t(`${base}.extra`, { advancedPlan: advanced.name })}`
                    : "";
                return (
                  <li key={item.key} className="dcbl-feat" data-reveal="" style={rd((i % 2) * 70)}>
                    <span className="dcbl-feat__icon">
                      <LandingIcon name={item.icon} size={19} />
                    </span>
                    <div className="dcbl-feat__body">
                      <h4 className="dcbl-feat__title">{t(`${base}.title`)}</h4>
                      <p className="dcbl-feat__text">
                        {t(`${base}.body`, vars)}
                        {rolesExtra}
                      </p>
                      {requiredPlan ? (
                        <span className="dcbl-badge dcbl-feat__badge">
                          {t("features.from", { plan: requiredPlan.name })}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

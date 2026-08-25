import Link from "next/link";
import { Check } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { BARBER_LANDING_ANCHORS, BARBER_REGISTER_PATH } from "@/lib/barber/marketing";
import { BarberHeroStage } from "./mockups";

/**
 * Portada. `from` es el precio del plan más barato YA formateado, que sale
 * de barber_plan_configs en la página — aquí no se escribe ninguna cifra.
 */
export function BarberHero({ t, from }: { t: TFunction; from: string }) {
  return (
    <section className="dcbl-hero">
      <div className="dcbl-wrap">
        <div className="dcbl-hero__grid">
          <div className="dcbl-hero__copy">
            <span className="dcbl-eyebrow">{t("hero.eyebrow")}</span>
            <h1 className="dcbl-h1">
              {t("hero.title")}
              <span className="dcbl-h1__accent">{t("hero.titleAccent")}</span>
            </h1>
            <p className="dcbl-lead dcbl-hero__lead">{t("hero.sub", { from })}</p>
            <div className="dcbl-hero__cta">
              <Link href={BARBER_REGISTER_PATH} className="dcbl-btn dcbl-btn--primary">
                {t("hero.cta")}
              </Link>
              <a href={`#${BARBER_LANDING_ANCHORS.pricing}`} className="dcbl-btn dcbl-btn--ghost">
                {t("hero.ctaSecondary")}
              </a>
            </div>
            <ul className="dcbl-trust">
              <li>
                <Check size={15} aria-hidden="true" />
                {t("hero.trust.fees")}
              </li>
              <li>
                <Check size={15} aria-hidden="true" />
                {t("hero.trust.cancel")}
              </li>
              <li>
                <Check size={15} aria-hidden="true" />
                {t("hero.trust.pesos")}
              </li>
            </ul>
          </div>
          <BarberHeroStage t={t} />
        </div>
      </div>
    </section>
  );
}

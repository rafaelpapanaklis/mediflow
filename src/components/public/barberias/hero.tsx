import Link from "next/link";
import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { BARBER_LANDING_ANCHORS, BARBER_REGISTER_PATH } from "@/lib/barber/marketing";
import { BarberHeroStage } from "./mockups";
import { OficioRail, OficioTijeras } from "./oficio";

/** Retraso de entrada (CSS var --d) de cada bloque de la portada. */
export function enter(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

/**
 * Portada. `from` es el precio del plan más barato YA formateado, que sale
 * de barber_plan_configs en la página — aquí no se escribe ninguna cifra.
 *
 * SE QUEDA EN SSR y sin JS propio: es el bloque LCP. El H1 y el lead no se
 * animan; la placa, los botones y la escena entran escalonados (CSS).
 * Debajo, la barra de herramientas del oficio remata la portada.
 */
export function BarberHero({ t, from }: { t: TFunction; from: string }) {
  return (
    <>
      <section className="dcbl-hero">
        <div className="dcbl-hero__grain" aria-hidden="true" />
        <div className="dcbl-hero__floor" aria-hidden="true" />
        <div className="dcbl-hero__glow" aria-hidden="true" />
        <div className="dcbl-wrap">
          <div className="dcbl-hero__grid">
            <div className="dcbl-hero__copy">
              <span className="dcbl-plate dcbl-enter" style={enter(0)}>
                <OficioTijeras size={16} />
                <span>{t("hero.eyebrow")}</span>
              </span>
              <h1 className="dcbl-h1">
                {t("hero.title")}
                <span className="dcbl-h1__accent">{t("hero.titleAccent")}</span>
              </h1>
              <p className="dcbl-lead dcbl-hero__lead">{t("hero.sub", { from })}</p>
              <div className="dcbl-hero__cta dcbl-enter" style={enter(120)}>
                <Link href={BARBER_REGISTER_PATH} className="dcbl-btn dcbl-btn--primary">
                  {t("hero.cta")}
                </Link>
                <a href={`#${BARBER_LANDING_ANCHORS.pricing}`} className="dcbl-btn dcbl-btn--ghost">
                  {t("hero.ctaSecondary")}
                </a>
              </div>
              <ul className="dcbl-trust dcbl-enter" style={enter(220)}>
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
      <div className="dcbl-rail" aria-hidden="true">
        <div className="dcbl-wrap dcbl-rail__in">
          <OficioRail size={24} />
        </div>
      </div>
    </>
  );
}

import type { CSSProperties } from "react";
import type { TFunction } from "@/i18n/t";
import { BARBER_LANDING_PROBLEMS } from "@/lib/barber/marketing";
import { LandingIcon } from "./icons";

/** Retraso del reveal (CSS var --rd) para escalonar una lista. */
export function rd(ms: number): CSSProperties {
  return { "--rd": `${ms}ms` } as CSSProperties;
}

/** El problema, en el lenguaje del gremio: la libreta, el WhatsApp a mano, las cuentas, la silla vacía. */
export function BarberProblem({ t }: { t: TFunction }) {
  return (
    <section className="dcbl-section dcbl-grain">
      <div className="dcbl-wrap">
        <div className="dcbl-head" data-reveal="">
          <span className="dcbl-eyebrow">{t("problem.eyebrow")}</span>
          <h2 className="dcbl-h2">{t("problem.title")}</h2>
        </div>
        <ul className="dcbl-problem__grid">
          {BARBER_LANDING_PROBLEMS.map((p, i) => (
            <li key={p.key} className="dcbl-pcard" data-reveal="" style={rd(i * 70)}>
              <span className="dcbl-pcard__num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="dcbl-pcard__icon">
                <LandingIcon name={p.icon} size={23} />
              </span>
              <h3 className="dcbl-pcard__title">{t(`problem.items.${p.key}.title`)}</h3>
              <p className="dcbl-pcard__body">{t(`problem.items.${p.key}.body`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

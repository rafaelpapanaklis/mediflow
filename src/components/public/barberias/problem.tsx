import type { TFunction } from "@/i18n/t";
import { BARBER_LANDING_PROBLEMS } from "@/lib/barber/marketing";
import { LandingIcon } from "./icons";

/** El problema, en el lenguaje del gremio: la libreta, el WhatsApp a mano, las cuentas, la silla vacía. */
export function BarberProblem({ t }: { t: TFunction }) {
  return (
    <section className="dcbl-section">
      <div className="dcbl-wrap">
        <div className="dcbl-head">
          <span className="dcbl-eyebrow">{t("problem.eyebrow")}</span>
          <h2 className="dcbl-h2">{t("problem.title")}</h2>
        </div>
        <ul className="dcbl-problem__grid">
          {BARBER_LANDING_PROBLEMS.map((p) => (
            <li key={p.key} className="dcbl-pcard">
              <span className="dcbl-pcard__icon">
                <LandingIcon name={p.icon} size={21} />
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

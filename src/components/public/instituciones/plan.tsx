import { Check } from "lucide-react";
import Link from "next/link";
import {
  EDU_LANDING_ANCHORS,
  EDU_LANDING_COPY,
  EDU_LANDING_FAQ,
  EDU_LOGIN_PATH,
  EDU_MANAGER,
  EDU_PLAN_INCLUYE,
  eduManagerDisplayPhone,
} from "@/lib/edu/marketing";
import { EduMark } from "./icons";
import { rd } from "./secciones";
import { WhatsappManagerCta } from "./whatsapp";

/**
 * UNA sola tarjeta y ni una cifra. La licencia es anual por institución y
 * se cotiza según el tamaño de la escuela; ese número lo dice el manager,
 * no una página que lee cualquiera. La letra chica de abajo lo declara sin
 * rodeos, que es lo contrario de esconderlo.
 */
export function SeccionPlan() {
  const t = EDU_LANDING_COPY.plan;
  return (
    <section className="dcei-section dcei-section--papel" id={EDU_LANDING_ANCHORS.plan}>
      <div className="dcei-wrap">
        <div className="dcei-head dcei-head--centro" data-reveal="">
          <span className="dcei-eyebrow">
            <span className="dcei-eyebrow__num" aria-hidden="true">
              VII
            </span>
            {t.eyebrow}
          </span>
          <h2 className="dcei-h2 dcei-balance">{t.titulo}</h2>
          <p className="dcei-lead dcei-pretty">{t.lead}</p>
        </div>

        <article className="dcei-plan" data-reveal="">
          <header className="dcei-plan__head">
            <span className="dcei-plan__sello" aria-hidden="true">
              <EduMark size={22} />
            </span>
            <h3 className="dcei-plan__name">{t.nombre}</h3>
          </header>

          <h4 className="dcei-plan__sub">{t.incluye}</h4>
          <ul className="dcei-plan__lista">
            {EDU_PLAN_INCLUYE.map((item, i) => (
              <li key={item.key} data-reveal="" style={rd(i * 45)}>
                <Check size={16} aria-hidden="true" />
                <span>{item.texto}</span>
              </li>
            ))}
          </ul>

          <div className="dcei-plan__accion">
            <WhatsappManagerCta label={t.cta} position="landing_plan" block />
            <p className="dcei-plan__chica">{t.letraChica}</p>
            <p className="dcei-plan__manager">
              {EDU_LANDING_COPY.final.managerEs} <strong>{EDU_MANAGER.nombre}</strong> ·{" "}
              <span className="dcei-plan__tel">{eduManagerDisplayPhone()}</span>
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

/**
 * Preguntas frecuentes con `<details>`: cero JavaScript, accesible con
 * teclado y con lector de pantalla. La página usa EXACTAMENTE estos textos
 * para el bloque de datos estructurados — Google exige que lo marcado sea
 * lo visible— porque los dos leen la misma lista.
 */
export function SeccionFaq() {
  const t = EDU_LANDING_COPY.faq;
  return (
    <section className="dcei-section" id={EDU_LANDING_ANCHORS.faq}>
      <div className="dcei-wrap dcei-wrap--angosto">
        <div className="dcei-head dcei-head--centro" data-reveal="">
          <span className="dcei-eyebrow">
            <span className="dcei-eyebrow__num" aria-hidden="true">
              VIII
            </span>
            {t.eyebrow}
          </span>
          <h2 className="dcei-h2 dcei-balance">{t.titulo}</h2>
        </div>
        <div className="dcei-faq" data-reveal="">
          {EDU_LANDING_FAQ.map((item, i) => (
            <details key={item.key} open={i === 0}>
              <summary>
                <span className="dcei-pretty">{item.q}</span>
                <span className="dcei-faq__mas" aria-hidden="true" />
              </summary>
              <p className="dcei-faq__a dcei-pretty">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** El cierre: el mismo botón, una vez más, con el nombre del manager. */
export function SeccionCierre() {
  const t = EDU_LANDING_COPY.final;
  return (
    <section className="dcei-section dcei-section--oscuro dcei-final">
      <div className="dcei-wrap">
        <div className="dcei-final__caja" data-reveal="">
          <span className="dcei-final__sello" aria-hidden="true">
            <EduMark size={24} />
          </span>
          <h2 className="dcei-h2 dcei-balance">{t.titulo}</h2>
          <p className="dcei-lead dcei-pretty">{t.cuerpo}</p>
          <WhatsappManagerCta label={t.cta} position="landing_final" />
          <p className="dcei-final__tel">
            {t.managerEs} <strong>{EDU_MANAGER.nombre}</strong> · {eduManagerDisplayPhone()}
          </p>
          <p className="dcei-final__entrar">
            {t.entrarPista} <Link href={EDU_LOGIN_PATH}>{t.entrar}</Link>
          </p>
        </div>
      </div>
    </section>
  );
}

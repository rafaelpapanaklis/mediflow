import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { EDU_LANDING_ANCHORS, EDU_LANDING_COPY } from "@/lib/edu/marketing";
import { Escena } from "./escena";
import { ArcadaEstatica } from "./estaticos";
import { WhatsappManagerCta } from "./whatsapp";

/** Retraso de entrada (variable CSS --d) de cada bloque de la portada. */
export function entra(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

/**
 * La portada. SIN `data-reveal` y sin JavaScript propio: es el bloque del
 * LCP. El título y la entradilla no se animan; la placa, los botones y la
 * lista de confianza entran escalonados con una transición de CSS que solo
 * toca opacidad y desplazamiento.
 *
 * La escena de la derecha nace como dibujo estático dentro del HTML y se
 * cambia por la versión tridimensional cuando la puerta lo decide, sin
 * mover un píxel: la caja tiene proporción fija.
 */
export function EduHero() {
  const t = EDU_LANDING_COPY.hero;
  return (
    <section className="dcei-hero">
      <div className="dcei-hero__trama" aria-hidden="true" />
      <div className="dcei-hero__resplandor" aria-hidden="true" />
      <div className="dcei-wrap">
        <div className="dcei-hero__grid">
          <div className="dcei-hero__copy">
            <span className="dcei-placa dcei-entra" style={entra(0)}>
              {t.eyebrow}
            </span>
            <h1 className="dcei-h1 dcei-balance">
              {t.titulo}
              <span className="dcei-h1__acento">{t.tituloAcento}</span>
            </h1>
            <p className="dcei-lead dcei-hero__lead dcei-pretty">{t.lead}</p>
            <div className="dcei-hero__cta dcei-entra" style={entra(140)}>
              <WhatsappManagerCta label={t.cta} position="landing_hero" />
              <a href={`#${EDU_LANDING_ANCHORS.flujo}`} className="dcei-btn dcei-btn--ghost">
                {t.ctaSecundario}
              </a>
            </div>
            <ul className="dcei-confianza dcei-entra" style={entra(240)}>
              {t.confianza.map((c) => (
                <li key={c}>
                  <Check size={15} aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <div className="dcei-hero__escena dcei-entra" style={entra(180)}>
            <Escena nombre="arcada" aria={t.escenaAria} className="dcei-escena--arcada">
              <ArcadaEstatica />
            </Escena>
          </div>
        </div>
      </div>
    </section>
  );
}

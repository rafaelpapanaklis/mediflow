import { Plus } from "lucide-react";
import { HOME_FAQS } from "./faq-data";

// Acordeón de la home. SERVER component: <details>/<summary> nativos toggle
// solos (accesibles por teclado, sin JS). El primer ítem va abierto (open)
// para mostrar el patrón de interacción de entrada.
export function FAQ() {
  return (
    <section className="lp-section" id="faq" aria-labelledby="faq-h">
      <div className="lp-container lp-container--narrow">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Preguntas frecuentes</p>
          <h2 id="faq-h" className="lp-h2">
            Lo que las clínicas preguntan antes de empezar.
          </h2>
        </div>

        <div className="lp-faq">
          {HOME_FAQS.map((f, i) => (
            <details
              key={f.q}
              className="lp-faq__item"
              {...(i === 0 ? { open: true } : {})}
            >
              <summary className="lp-faq__q">
                {f.q}
                <Plus
                  className="lp-faq__icon"
                  size={20}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </summary>
              <p className="lp-faq__a">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

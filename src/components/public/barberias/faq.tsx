import { Plus } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { BARBER_LANDING_ANCHORS } from "@/lib/barber/marketing";

export interface BarberFaqItem {
  key: string;
  q: string;
  a: string;
}

/**
 * Preguntas frecuentes con <details>: cero JavaScript, accesible con
 * teclado y lector de pantalla. La página arma los textos (con los planes
 * y el costo de WhatsApp ya interpolados) y usa EXACTAMENTE los mismos para
 * el FAQPage del JSON-LD: Google exige que lo marcado sea lo visible. La
 * numeración la pone el CSS (counter), no el diccionario.
 */
export function BarberFaq({ t, items }: { t: TFunction; items: BarberFaqItem[] }) {
  return (
    <section className="dcbl-section dcbl-section--tight dcbl-grain" id={BARBER_LANDING_ANCHORS.faq}>
      <div className="dcbl-wrap">
        <div className="dcbl-head dcbl-head--center" data-reveal="">
          <span className="dcbl-eyebrow">{t("faq.eyebrow")}</span>
          <h2 className="dcbl-h2">{t("faq.title")}</h2>
        </div>
        <div className="dcbl-faq" data-reveal="">
          {items.map((item, i) => (
            <details key={item.key} open={i === 0}>
              <summary>
                <span>{item.q}</span>
                <Plus size={18} className="dcbl-faq__icon" aria-hidden="true" />
              </summary>
              <p className="dcbl-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

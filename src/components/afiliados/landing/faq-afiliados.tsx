"use client";

/**
 * Acordeón de preguntas frecuentes del programa de afiliados.
 *
 * Mismo patrón (y mismas clases `.mfh-faq*`) que el FAQ de la home, para no
 * inventar un segundo componente de acordeón. La diferencia: las preguntas NO
 * viven aquí, llegan como prop desde el server component de /afiliados. Así el
 * JSON-LD de FAQPage y lo que el visitante ve en pantalla salen del MISMO
 * array —imposible que se desincronicen— y las respuestas que dependen de la
 * config (el cobro en el que arranca la comisión) se arman con datos en vivo.
 *
 * El wrapper `.afi-faq` sube el max-height del panel abierto: estas respuestas
 * son más largas que las de la home y el tope de 320px de sales.css las
 * cortaba a media frase.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FaqItem {
  q: string;
  a: string;
}

export function FaqAfiliados({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  if (items.length === 0) return null;

  return (
    <div className="afi-faq">
      <div className="mfh-faq">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className="mfh-faq__item" data-open={isOpen}>
              <button
                type="button"
                className="mfh-faq__q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{item.q}</span>
                <ChevronDown />
              </button>
              <div className="mfh-faq__a" role="region">
                <p>{item.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

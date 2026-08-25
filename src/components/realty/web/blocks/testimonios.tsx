/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: TESTIMONIOS (solo modo AGENT).

   ── LO QUE NO SE HACE, Y POR QUÉ ─────────────────────────────────
   Estos testimonios NO salen en el JSON-LD como `review` ni alimentan un
   `aggregateRating`. Los escribe el propio asesor en su editor: no vienen
   de Google ni de un tercero verificable. Marcarlos como reseñas
   estructuradas sería pedirle a Google que pinte estrellas en el buscador
   a partir de un texto que escribió el interesado — que es justo lo que
   sus guías de reseñas autogeneradas prohíben, y por lo que se penaliza
   el sitio entero. Se pintan en la página y ahí se quedan.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";

const ID = "testimonios";

export function BloqueTestimonios({ data }: { data: RealtyWebData }) {
  const { config } = data;
  if (config.testimonios.length === 0) return null;
  const v = variante(data, ID) || "tarjetas";

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado />
      <ul className={`dcrw-testimonios dcrw-testimonios-${v}`}>
        {config.testimonios.map((t, i) => (
          <li key={`${t.nombre}-${i}`}>
            <figure className="dcrw-testimonio">
              <blockquote>{t.texto}</blockquote>
              <figcaption>
                <strong>{t.nombre}</strong>
                {t.contexto ? <span>{t.contexto}</span> : null}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Sec>
  );
}

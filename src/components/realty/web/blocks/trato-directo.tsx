/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: TRATO DIRECTO CON EL DUEÑO (solo modo OWNER).

   🔴 ESTE BLOQUE ES EL ARGUMENTO DE VENTA DEL MODO ENTERO.

   En México la inmobiliaria cobra al inquilino un mes de renta por
   colocarlo. "Trato directo con el dueño, sin comisión" significa que ese
   mes se lo queda él, y por eso es un gancho real y no un adorno: es la
   única ventaja que un rentista tiene sobre una agencia con veinte
   anuncios en los portales.

   Lo que NO dice: nada sobre precios, descuentos ni promesas de rapidez.
   Solo el hecho —hablas con el dueño— y el botón para hacerlo.

   Variantes: `banda`, `nota` y la premium `cinta` (disponibilidad): una
   cinta delgada del color del acento, pegada a la portada, con el botón de
   WhatsApp a la derecha — el CSS vive en secundarios.css.
   ═══════════════════════════════════════════════════════════════════════ */

import { ligaWhatsApp, type RealtyWebData } from "@/lib/realty/landing";
import { copia, subtitulo, titulo, variante, whatsappDe, Sec } from "@/components/realty/web/helpers";
import { IcoWhatsApp } from "@/components/realty/web/pieces";

const ID = "trato-directo";

export function BloqueTratoDirecto({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID) || "banda";
  const wa = ligaWhatsApp(
    whatsappDe(data),
    `Hola, vi tus inmuebles en internet y me interesa rentar.`,
  );
  const t = titulo(data, ID);
  const s = subtitulo(data, ID);
  const nota = copia(data, ID, "tratoDirecto.nota");

  return (
    <Sec id={ID} variante={v}>
      <div className={`dcrw-trato dcrw-trato-${v}`}>
        <div className="dcrw-trato-texto">
          <h2 className="dcrw-trato-titulo">{t}</h2>
          {s ? <p className="dcrw-trato-bajada">{s}</p> : null}
          {nota ? <p className="dcrw-trato-nota">{nota}</p> : null}
        </div>
        {wa ? (
          <a className="dcrw-btn dcrw-btn-whatsapp" href={wa} target="_blank" rel="noopener noreferrer">
            <IcoWhatsApp />
            {copia(data, ID, "tratoDirecto.cta")}
          </a>
        ) : null}
      </div>
    </Sec>
  );
}

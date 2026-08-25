"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL MAPA, PERO SOLO SI ALGUIEN LO PIDE.

   ── POR QUÉ NO SE CARGA SOLO ──────────────────────────────────────
   Un iframe de Google Maps son cientos de kilobytes de JavaScript de
   terceros y varias peticiones bloqueantes. En una página que aspira a un
   PSI móvil como el del sitio (94) es, con diferencia, lo más caro que se
   puede meter — y la mayoría de los visitantes nunca lo toca. Aquí se pinta
   un recuadro con la ubicación en texto y un botón; el iframe se monta al
   primer clic y ya no se desmonta.

   ── LA CSP ───────────────────────────────────────────────────────
   www.google.com YA está en el `frame-src` de next.config.mjs (lo puso el
   tag de conversiones de Google Ads), así que este embed carga sin tocar
   nada compartido. Un dominio fuera de esa lista pintaría un marco EN
   BLANCO sin un solo error en consola.

   ── LA PRIVACIDAD ────────────────────────────────────────────────
   La URL del embed la arma embedMapa() en @/lib/realty/landing, que es el
   ÚNICO sitio donde se decide si va la calle o solo la colonia. Este
   componente recibe la cadena ya hecha: no puede filtrar de más ni aunque
   se equivoque quien lo use.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from "react";
import { IcoMapa } from "@/components/realty/web/pieces";

export function MapaBajoDemanda({
  src,
  titulo,
  ubicacion,
  etiquetaAbrir,
  etiquetaComoLlegar,
  ligaComoLlegar,
  aviso,
}: {
  /** URL del embed, ya construida por embedMapa(). */
  src: string;
  titulo: string;
  ubicacion: string;
  etiquetaAbrir: string;
  etiquetaComoLlegar: string;
  ligaComoLlegar: string | null;
  /** Aviso de "ubicación aproximada" cuando la dirección exacta no se enseña. */
  aviso?: string | null;
}) {
  const [montado, setMontado] = useState(false);

  return (
    <div className="dcrw-mapa">
      {montado ? (
        <iframe
          src={src}
          title={titulo}
          className="dcrw-mapa-marco"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <button type="button" className="dcrw-mapa-cartel" onClick={() => setMontado(true)}>
          <span className="dcrw-mapa-pin" aria-hidden="true">
            <IcoMapa size={22} />
          </span>
          <span className="dcrw-mapa-donde">{ubicacion}</span>
          <span className="dcrw-btn dcrw-btn-secundario dcrw-mapa-boton">{etiquetaAbrir}</span>
        </button>
      )}

      <div className="dcrw-mapa-pie">
        {aviso ? <p className="dcrw-mapa-aviso">{aviso}</p> : null}
        {ligaComoLlegar ? (
          <a
            className="dcrw-mapa-liga"
            href={ligaComoLlegar}
            target="_blank"
            rel="noopener noreferrer"
          >
            {etiquetaComoLlegar}
          </a>
        ) : null}
      </div>
    </div>
  );
}

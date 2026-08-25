"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL RECORRIDO VIRTUAL: PORTADA CON BOTÓN, IFRAME AL PRIMER CLIC.

   Matterport, Kuula y compañía cargan varios megabytes de WebGL. Montarlos
   con la página convertiría una ficha de inmueble en la página más pesada
   del sitio para el 90% de los visitantes que nunca les da clic. Aquí se
   pinta la foto de portada del inmueble con un botón de reproducir encima;
   el iframe se monta cuando alguien lo pide.

   La URL viene YA convertida por urlEmbedRecorrido() — un
   youtube.com/watch dentro de un iframe no se reproduce, y un host fuera
   del frame-src sale EN BLANCO sin un solo error en consola.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from "react";
import {
  REALTY_TOUR_IFRAME_ALLOW,
  REALTY_TOUR_IFRAME_SANDBOX,
} from "@/lib/realty/tours";
import { Foto, IcoRecorrido, SinFoto } from "@/components/realty/web/pieces";

export function EmbedRecorrido({
  src,
  titulo,
  etiqueta,
  proveedor,
  portada,
}: {
  /** URL del embed, ya construida por urlEmbedRecorrido(). */
  src: string;
  titulo: string;
  etiqueta: string;
  proveedor: string;
  portada: { url: string; width: number | null; height: number | null } | null;
}) {
  const [montado, setMontado] = useState(false);

  if (montado) {
    return (
      <div className="dcrw-recorrido dcrw-recorrido-vivo">
        {/* `allow` y `sandbox` salen del contrato (src/lib/realty/tours.ts),
            no de aquí: son la misma reja que usa el panel al previsualizar
            un recorrido, y un iframe de tercero no tiene por qué poder
            navegar la pestaña ni abrir ventanas. */}
        <iframe
          src={src}
          title={titulo}
          className="dcrw-recorrido-marco"
          loading="lazy"
          allow={REALTY_TOUR_IFRAME_ALLOW}
          sandbox={REALTY_TOUR_IFRAME_SANDBOX}
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    );
  }

  return (
    <button type="button" className="dcrw-recorrido" onClick={() => setMontado(true)}>
      {portada ? (
        <Foto url={portada.url} alt={titulo} width={portada.width} height={portada.height} />
      ) : (
        <SinFoto etiqueta={etiqueta} />
      )}
      <span className="dcrw-recorrido-capa" aria-hidden="true" />
      <span className="dcrw-recorrido-boton">
        <IcoRecorrido size={20} />
        <span>{etiqueta}</span>
        <small>{proveedor}</small>
      </span>
    </button>
  );
}

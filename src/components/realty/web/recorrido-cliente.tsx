"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL RECORRIDO VIRTUAL: PORTADA CON BOTÓN, IFRAME AL PRIMER CLIC.

   Matterport, Kuula y compañía cargan varios megabytes de WebGL. Montarlos
   con la página convertiría una ficha de inmueble en la página más pesada
   del sitio para el 90% de los visitantes que nunca les da clic. Aquí se
   pinta la foto de portada del inmueble con un botón de reproducir encima;
   el iframe se monta cuando alguien lo pide.

   La URL viene YA convertida por realtyTourEmbedUrl() — un
   youtube.com/watch dentro de un iframe no se reproduce, una liga de
   Matterport que no sea la de Compartir tampoco, y un host fuera del
   frame-src sale EN BLANCO sin un solo error en consola. Cuando aun así no
   carga, RealtyTourEmbed lo dice en pantalla en vez de dejar el gris.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from "react";
import { RealtyTourEmbed } from "@/components/realty/tours/tour-embed";
import { Foto, IcoRecorrido, SinFoto } from "@/components/realty/web/pieces";

export function EmbedRecorrido({
  src,
  href,
  titulo,
  etiqueta,
  proveedor,
  portada,
}: {
  /** URL del embed, ya construida por realtyTourEmbedUrl(). */
  src: string;
  /**
   * La liga TAL COMO SE GUARDÓ, para abrirla fuera cuando el marco falla.
   * No es lo mismo que `src`: la de embed de YouTube, por ejemplo, se abre
   * sin controles ni recomendaciones y no es la que uno querría compartir.
   */
  href?: string;
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
            navegar la pestaña ni abrir ventanas.

            Y el marco NO se queda en gris si el recorrido no carga: el
            visitante ve un aviso con la liga para abrirlo aparte, en vez de
            un recuadro mudo que le hace pensar que la página está rota. */}
        <RealtyTourEmbed
          src={src}
          href={href}
          title={titulo}
          className="dcrw-recorrido-marco"
          referrerPolicy="no-referrer-when-downgrade"
          avisoTitulo="El recorrido no se está mostrando"
          avisoCuerpo="Puede que tarde de más o que tu conexión lo esté bloqueando. Ábrelo en una pestaña nueva."
          avisoAbrir={`Ver el recorrido en ${proveedor}`}
          avisoCerrar="Seguir esperando"
          // La web pública SÍ lleva la salida siempre visible: es el único
          // sitio donde el visitante no tiene otra forma de abrir el
          // recorrido si el marco se queda mudo.
          salidaSiempre
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

"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL MARCO DEL RECORRIDO — Y LA SALIDA CUANDO NO SE VE.

   🔴 POR QUÉ EXISTE. Un iframe de tercero que no se puede mostrar NO avisa
   a la página que lo contiene. No lanza excepción, no dispara `onError`, no
   escribe nada en la consola de quien lo embebe: se queda en gris, a veces
   con el icono de recurso roto. Da igual el motivo —la liga no era la de
   Compartir, el dueño del espacio apagó el embebido, el proveedor está
   caído, la red del cliente lo bloquea—, el síntoma es siempre el mismo
   recuadro mudo, y siempre se diagnostica mal ("Matterport está caído").

   🔴 Y OJO CON EL DETALLE QUE ARRUINA LA SOLUCIÓN OBVIA: cuando el
   proveedor rechaza el embebido (X-Frame-Options / frame-ancestors), el
   navegador pinta SU PROPIA página de error dentro del marco y dispara
   `load` igualmente. Un "si a los N segundos no cargó, avisa" NO atrapa ese
   caso — que es justo el más común. Por eso aquí hay DOS redes y no una:

     1. SIEMPRE, cargue o no: una salida visible para abrir el recorrido en
        una pestaña. Es lo único que funciona cuando el marco "cargó" un
        error. Nunca hay un recuadro sin explicación ni escapatoria.
     2. SI TARDA DE MÁS: el aviso grande encima, con el motivo probable.
        Cubre la red lenta, el proveedor caído y el bloqueo de la red del
        cliente, donde `load` no llega nunca.

   La red de VERDAD, sin embargo, es la de antes de guardar:
   `checkRealtyTourUrl` rechaza al pegarla la liga que no se va a poder
   embeber. Esto de aquí es lo que queda para lo que no se puede prever.

   `allow` y `sandbox` siguen saliendo del contrato (src/lib/realty/tours.ts):
   este componente no inventa permisos.

   Se usa en los DOS mundos —el panel (ficha del inmueble) y la web pública
   (/i/[slug])—, así que no depende de los tokens de ninguno de los dos: los
   avisos llevan sus colores puestos, sobre un velo oscuro que se lee encima
   de cualquier fondo. El `className` que recibe es el que ya tenía el
   iframe, así que ocupa exactamente la misma caja de antes.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from "react";
import {
  REALTY_TOUR_IFRAME_ALLOW,
  REALTY_TOUR_IFRAME_SANDBOX,
} from "@/lib/realty/tours";

/** Margen antes de dar por perdido el recorrido. Un Matterport pesado en
 *  una red de una casa en obra tarda; 8 s es esperar sin desesperar. */
const ESPERA_MS = 8000;

export interface RealtyTourEmbedProps {
  /** URL YA convertida por realtyTourEmbedUrl(). */
  src: string;
  title: string;
  /** La clase que llevaba el iframe: define la caja (ancho y proporción). */
  className?: string;
  /** La liga tal como se guardó, para abrirla fuera. Si falta, se usa `src`. */
  href?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  /** Textos: cada mundo pone los suyos (el panel, desde su diccionario). */
  avisoTitulo?: string;
  avisoCuerpo?: string;
  avisoAbrir?: string;
  esperaMs?: number;
}

export function RealtyTourEmbed({
  src,
  title,
  className,
  href,
  referrerPolicy = "strict-origin-when-cross-origin",
  avisoTitulo = "El recorrido no se está mostrando",
  avisoCuerpo = "Puede que la liga no sea la de Compartir, o que el proveedor no permita " +
    "verlo dentro de otra página. Ábrelo en una pestaña nueva para comprobarlo.",
  avisoAbrir = "Abrir el recorrido",
  esperaMs = ESPERA_MS,
}: RealtyTourEmbedProps) {
  const [cargado, setCargado] = useState(false);
  const [tarde, setTarde] = useState(false);

  useEffect(() => {
    // Cada `src` nuevo reinicia el reloj: cambiar de recorrido no debe
    // heredar el veredicto del anterior.
    setCargado(false);
    setTarde(false);
    const id = window.setTimeout(() => setTarde(true), Math.max(1000, esperaMs));
    return () => window.clearTimeout(id);
  }, [src, esperaMs]);

  const mostrarAviso = tarde && !cargado;
  const ligaFuera = href || src;

  return (
    <div className={className} style={{ position: "relative" }}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allow={REALTY_TOUR_IFRAME_ALLOW}
        sandbox={REALTY_TOUR_IFRAME_SANDBOX}
        allowFullScreen
        referrerPolicy={referrerPolicy}
        onLoad={() => setCargado(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
        }}
      />

      {/* RED 1 — siempre presente. Chiquita, en una esquina, sin tapar el
          recorrido cuando sí se ve; y es la ÚNICA salida cuando el marco
          "cargó" la página de error del propio navegador. */}
      {mostrarAviso ? null : (
        <a
          href={ligaFuera}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            zIndex: 2,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 9px",
            borderRadius: 8,
            background: "rgba(14, 30, 22, 0.72)",
            color: "#EDF3EF",
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1.3,
            textDecoration: "none",
            backdropFilter: "blur(2px)",
          }}
        >
          {avisoAbrir}
        </a>
      )}

      {/* RED 2 — el aviso grande cuando `load` no llegó nunca. */}
      {mostrarAviso ? (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: 20,
            textAlign: "center",
            background: "rgba(14, 30, 22, 0.92)",
            color: "#EDF3EF",
          }}
        >
          <strong style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{avisoTitulo}</strong>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, maxWidth: 380, opacity: 0.85 }}>
            {avisoCuerpo}
          </p>
          <a
            href={ligaFuera}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              // pine-600: el único de la escala que pasa AA con texto blanco.
              background: "#2F6B4D",
              color: "#FFFFFF",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {avisoAbrir}
          </a>
        </div>
      ) : null}
    </div>
  );
}

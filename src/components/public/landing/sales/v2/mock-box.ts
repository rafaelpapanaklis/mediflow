import type { CSSProperties } from "react";

/**
 * Caja que posiciona el mockup dentro de cada tarjeta de "Funciones".
 *
 * Vive en su propio módulo (sin "use client") porque la comparten el server
 * component que pinta la sección y el client component que difiere el mockup:
 * el hueco reservado y el mockup real ocupan EXACTAMENTE la misma caja.
 *
 * El `translateY` hace que el mockup asome por el borde inferior de la tarjeta
 * (que recorta con overflow:hidden). `transform` no afecta al layout, así que
 * el alto que hay que reservar es el natural del `<figure>`.
 */
export const MOCK_BOX: CSSProperties = {
  marginTop: "clamp(18px,2.4vw,28px)",
  width: "100%",
  maxWidth: 520,
  marginLeft: "auto",
  marginRight: "auto",
  transform: "translateY(clamp(10px,1.6vw,20px))",
};

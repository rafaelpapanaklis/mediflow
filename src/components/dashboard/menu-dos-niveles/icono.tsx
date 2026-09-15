import type { CSSProperties } from "react";
import s from "./menu-dos-niveles.module.css";

/**
 * Ícono de Material Symbols Rounded (fuente de ligaduras, ver iconos.ts).
 * Decorativo: siempre `aria-hidden`; el nombre accesible lo lleva el botón o
 * enlace que lo contiene. La caja es fija (1em × 1em) y recorta, así que si la
 * fuente aún no cargó nunca se ve la palabra desbordando la fila.
 */
export function Icono({
  nombre,
  relleno = false,
  className,
  style,
}: {
  nombre: string;
  relleno?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      translate="no"
      className={[s.icono, relleno ? s.iconoRelleno : "", className ?? ""].filter(Boolean).join(" ")}
      style={style}
    >
      {nombre}
    </span>
  );
}

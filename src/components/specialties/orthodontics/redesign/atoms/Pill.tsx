// Atom: etiqueta de estado (fase, mes, borrador…). La misma píldora que la
// ficha del paciente: fondo suave del estado y su color lleno como texto.

import type { ReactNode } from "react";
import orto from "../orto.module.css";

export type PillColor = "slate" | "violet" | "emerald" | "amber" | "rose" | "sky" | "white";
type PillSize = "xs" | "sm";

// El idioma del panel no tiene azul «info»: lo informativo va en violeta.
const COLORS: Record<PillColor, string> = {
  slate: orto.etiquetaNeutra,
  violet: orto.etiquetaVioleta,
  emerald: orto.etiquetaExito,
  amber: orto.etiquetaAlerta,
  rose: orto.etiquetaPeligro,
  sky: orto.etiquetaVioleta,
  white: orto.etiquetaContorno,
};

const SIZES: Record<PillSize, string> = {
  xs: orto.etiquetaChica,
  sm: "",
};

export interface PillProps {
  children: ReactNode;
  color?: PillColor;
  size?: PillSize;
  className?: string;
}

export function Pill({ children, color = "slate", size = "sm", className = "" }: PillProps) {
  return (
    <span className={[orto.etiqueta, COLORS[color], SIZES[size], className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}

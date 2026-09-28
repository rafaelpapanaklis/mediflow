// Atom: Botón del módulo de Ortodoncia. Mismo cuerpo que los botones de la
// ficha del paciente (38/36 px, radio 10, 13 px/600); los colores salen de
// los tokens que monta RAIZ_ORTO.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import orto from "../orto.module.css";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "emerald"
  | "rose"
  | "violet-soft"
  | "emerald-soft"
  | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: orto.botonPrincipal,
  secondary: "",
  ghost: orto.botonFantasma,
  emerald: orto.botonExito,
  rose: orto.botonPeligro,
  "violet-soft": orto.botonSuave,
  "emerald-soft": orto.botonExitoSuave,
  danger: orto.botonPeligroSuave,
};

const SIZES: Record<Size, string> = {
  sm: orto.botonChico,
  md: "",
  lg: orto.botonGrande,
};

export interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Btn({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  type = "button",
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={[orto.boton, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

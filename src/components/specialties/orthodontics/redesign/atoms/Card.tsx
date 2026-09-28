// Atom: tarjeta de sección del módulo de Ortodoncia.
// La misma tarjeta que la ficha del paciente: chip de icono de 28 px, título
// 14 px/650 y, debajo, una línea que explica (no una clave interna). La
// cabecera envuelve: con muchas acciones, los botones bajan a su renglón en
// vez de estrujar el título.

import type { ReactNode } from "react";
import orto from "../orto.module.css";

type AccentColor = "violet" | "emerald" | "amber" | "rose" | "slate";

const ICON_TONE: Record<AccentColor, string> = {
  violet: "",
  emerald: orto.tarjetaIconoExito,
  amber: orto.tarjetaIconoAlerta,
  rose: orto.tarjetaIconoPeligro,
  slate: orto.tarjetaIconoNeutro,
};

export interface CardProps {
  id?: string;
  /** Línea de apoyo bajo el título. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** Icono de la sección (lucide, 15 px). Se pinta en un chip a la izquierda. */
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  /** Tono del chip del icono. */
  accent?: AccentColor;
}

export function Card(props: CardProps) {
  const { id, eyebrow, title, icon, action, children, className = "", footer, accent } = props;
  const hasHeader = Boolean(title || action || eyebrow);
  return (
    <section id={id} className={[orto.tarjeta, className].filter(Boolean).join(" ")}>
      {hasHeader ? (
        <header className={orto.tarjetaCabeza}>
          {icon ? (
            <span
              className={[orto.tarjetaIcono, accent ? ICON_TONE[accent] : ""].filter(Boolean).join(" ")}
              aria-hidden
            >
              {icon}
            </span>
          ) : null}
          <div className={orto.tarjetaTextos}>
            {title ? <h3 className={orto.tarjetaTitulo}>{title}</h3> : null}
            {eyebrow ? <div className={orto.tarjetaSub}>{eyebrow}</div> : null}
          </div>
          {action ? <div className={orto.tarjetaAcciones}>{action}</div> : null}
        </header>
      ) : null}
      <div>{children}</div>
      {footer ? <footer className={orto.tarjetaPie}>{footer}</footer> : null}
    </section>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { instrumentSans } from "@/fonts/menu";
import s from "./rediseno.module.css";

/**
 * La raíz del rediseño de Equipo: no monta un sistema visual nuevo, solo
 * REDECLARA sobre este subárbol los tokens del sistema de diseño existente
 * (--brand, --border-soft, --shadow-1…) con los valores del lenguaje visual
 * ya aprobado (menú de dos niveles / Pacientes). Como `.card`, `.kpi`,
 * `.btn-new--primary`, `.badge-new--brand`, etc. ya LEEN esas variables, la
 * pantalla entera cambia de acento sin tocar `globals.css` ni duplicar cada
 * clase compartida.
 *
 * Misma fuente que el menú (`src/fonts/menu.ts`), sin precarga: solo la
 * pintan las clínicas con el interruptor encendido.
 */
export function RaizRediseno({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={[s.tokens, instrumentSans.variable, className ?? ""].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </div>
  );
}

/** Las clases de la raíz, para quien necesite ponerlas en un nodo propio. */
export const CLASES_REDISENO = [s.tokens, instrumentSans.variable].join(" ");

import type { CSSProperties, ReactNode } from "react";
import { instrumentSans } from "@/fonts/menu";
import s from "./rediseno.module.css";

/**
 * La raíz del rediseño de Pacientes: pone la tipografía y los tokens de
 * color, y nada más.
 *
 * La FUENTE es la misma instancia que declara el menú de dos niveles
 * (`src/fonts/menu.ts`), no una copia: `next/font/local` emite un solo
 * `@font-face` por declaración, así que importarla aquí no descarga otro
 * archivo ni añade otro peso. Va sin precarga, igual que allí — solo la
 * pintan las clínicas que tienen el interruptor encendido.
 *
 * Los tokens (`--pr-*`) se HEREDAN desde este nodo, así que las reglas del
 * rediseño que viven en otros módulos CSS (la lista, la cabecera de la ficha)
 * los leen sin importar nada, con estar dentro.
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

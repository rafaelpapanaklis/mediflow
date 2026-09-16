import type { CSSProperties, ReactNode } from "react";
import { instrumentSans } from "@/fonts/menu";
import s from "./inventario-rediseno.module.css";

/**
 * La raíz del rediseño de Inventario: pone la tipografía y los tokens de
 * color, y nada más. Mismo patrón que `pacientes-rediseno/raiz.tsx` — cada
 * pantalla rediseñada declara su propia raíz porque `clases.ts` es
 * compartido y lo tocan otras pantallas a la vez.
 *
 * La FUENTE es la misma instancia que declara el menú de dos niveles
 * (`src/fonts/menu.ts`), no una copia: `next/font/local` emite un solo
 * `@font-face` por declaración, así que importarla aquí no descarga otro
 * archivo ni añade otro peso.
 */
export function RaizRedisenoInventario({
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
export const CLASES_REDISENO_INVENTARIO = [s.tokens, instrumentSans.variable].join(" ");

import type { CSSProperties, ReactNode } from "react";
import { instrumentSans } from "@/fonts/menu";
import s from "./recursos-rediseno.module.css";

/**
 * La raíz del rediseño de Recursos: pone la tipografía y los tokens de
 * color, y nada más. Mismo patrón que `pacientes-rediseno/raiz.tsx`.
 *
 * Los tokens (`--rec-*`) se HEREDAN desde este nodo, así que las reglas
 * del rediseño que viven en `recursos-rediseno.module.css` los leen sin
 * importar nada, con estar dentro.
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

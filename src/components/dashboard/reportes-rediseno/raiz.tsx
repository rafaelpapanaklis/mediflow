import type { CSSProperties, ReactNode } from "react";
import { instrumentSans } from "@/fonts/menu";
import s from "./rediseno.module.css";

/**
 * La raíz del rediseño de Reportes (WS1-T5): no monta un sistema visual
 * nuevo, solo REDECLARA sobre este subárbol los tokens del sistema de
 * diseño existente (--brand, --border-soft, --shadow-1…) con los valores
 * del lenguaje visual ya aprobado (menú de dos niveles / Pacientes /
 * Equipo). Como `KpiCard`, `CardNew` y las gráficas de recharts de esta
 * pantalla ya LEEN esas variables (nunca un hex a mano), la pantalla
 * entera —tarjetas, barras, tooltip— cambia de acento sin tocar
 * `globals.css` ni duplicar la gráfica.
 *
 * Misma fuente que el menú (`src/fonts/menu.ts`), sin precarga: solo la
 * pintan las clínicas con el interruptor `menu-dos-niveles` encendido.
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

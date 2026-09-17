import type { CSSProperties, ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./rediseno.module.css";

/**
 * La raíz del rediseño de Reportes (WS1-T5): KPIs, gráficas y tablas,
 * vestidos con el mismo lenguaje visual que el menú de dos niveles y «Hoy».
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las reglas de
 * `rediseno.module.css` sobreescriben, solo dentro de este subárbol, las
 * clases compartidas de globals.css (`.card`, `.kpi`, `.table-new`…) leyendo
 * esos tokens por herencia, y las gráficas de recharts reciben
 * `var(--m2-activo)` desde `reports-client.tsx`. Así, si el menú cambia de
 * color, Reportes cambia con él, y no hay una segunda paleta que mantener.
 *
 * Solo se monta con el interruptor `menu-dos-niveles` encendido para la
 * clínica. Apagado, la pantalla se pinta exactamente como hoy: no se monta
 * ni un nodo de aquí.
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
    <div className={[CLASES_MENU, s.raiz, className ?? ""].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}

/** Las clases de la raíz, para quien necesite ponerlas en un nodo propio. */
export const CLASES_REDISENO = `${CLASES_MENU} ${s.raiz}`;

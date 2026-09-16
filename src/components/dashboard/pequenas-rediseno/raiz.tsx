import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./pequenas.module.css";

/**
 * La raíz del rediseño de las tres pantallas pequeñas (Reseñas, Pantallas TV
 * y Bitácora), vestidas con el mismo lenguaje visual que el menú de dos
 * niveles, Pacientes, la Agenda y «Hoy».
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de
 * `pequenas.module.css` leen esos tokens por herencia. Así, si el menú cambia
 * de color, las tres pantallas cambian con él, y no hay una segunda paleta
 * que mantener.
 *
 * Solo la montan los clientes de cada pantalla cuando el interruptor por
 * clínica `menu-dos-niveles` (`clinic_feature_flags`) está encendido y la
 * página se lo baja como `rediseno`. Apagado, cada cliente devuelve su
 * marcado de siempre, que no comparte ni un nodo con esto.
 */
export function RaizPequenas({
  ancho = "completo",
  children,
}: {
  /** `estrecho` = 880 px (Reseñas), `medio` = 1200 px (Pantallas TV), `completo` = 1240 px. */
  ancho?: "estrecho" | "medio" | "completo";
  children: ReactNode;
}) {
  const clase = ancho === "estrecho" ? s.raizEstrecha : ancho === "medio" ? s.raizMedia : "";
  return <div className={`${CLASES_MENU} ${s.raiz} ${clase}`.trim()}>{children}</div>;
}

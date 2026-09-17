import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./hoy.module.css";

/**
 * La raíz del rediseño de «Hoy»: la pantalla de inicio del panel, vestida con
 * el mismo lenguaje visual que el menú de dos niveles, Pacientes y la Agenda.
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de `hoy.module.css`
 * leen esos tokens por herencia. Así, si el menú cambia de color, «Hoy» cambia
 * con él, y no hay una segunda paleta que mantener.
 *
 * Solo la monta `src/app/dashboard/page.tsx` cuando el interruptor por clínica
 * `menu-dos-niveles` (`clinic_feature_flags`) está encendido. Apagado, la
 * página renderiza `HomeShell` y la home de siempre (`components/dashboard/home/`),
 * que no comparte ni un nodo con esto: no puede cambiar ni un píxel por culpa
 * de este rediseño.
 *
 * Es un componente sin hooks para que el server component lo pueda montar
 * directamente; lo que va dentro sí es de cliente.
 */
export function RaizHoy({ children }: { children: ReactNode }) {
  return <div className={`${CLASES_MENU} ${s.raiz}`}>{children}</div>;
}

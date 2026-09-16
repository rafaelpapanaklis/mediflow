import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./finanzas.module.css";

/**
 * La raíz del rediseño de «Finanzas»: la pantalla donde el dueño mira si la
 * clínica gana dinero, vestida con el mismo lenguaje visual que el menú de
 * dos niveles, «Hoy», Pacientes y la Agenda.
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de
 * `finanzas.module.css` leen esos tokens por herencia, y la gráfica los lee en
 * JS desde este mismo nodo. Así, si el menú cambia de color, Finanzas cambia
 * con él, y no hay una segunda paleta que mantener.
 *
 * Solo la monta `src/app/dashboard/finanzas/page.tsx` cuando el interruptor
 * por clínica `menu-dos-niveles` (`clinic_feature_flags`) está encendido.
 * Apagado, la página renderiza `FinanzasClient` (`finanzas-client.tsx`), que
 * no comparte ni un nodo con esto: no puede cambiar ni un píxel por culpa de
 * este rediseño.
 *
 * Es un componente sin hooks para que el server component lo pueda montar
 * directamente; lo que va dentro sí es de cliente.
 */
export function RaizFinanzas({ children }: { children: ReactNode }) {
  return <div className={`${CLASES_MENU} ${s.raiz}`}>{children}</div>;
}

/** Un aviso centrado y apagado (el «solo administradores» de la página). */
export function AvisoFinanzas({ children }: { children: ReactNode }) {
  return <p className={s.mensajeVacio}>{children}</p>;
}

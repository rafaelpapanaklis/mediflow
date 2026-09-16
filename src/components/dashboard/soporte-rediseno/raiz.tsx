import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./soporte.module.css";

/**
 * La raíz del rediseño de Soporte Técnico (ws1-t4): la lista de tickets y el
 * hilo de un ticket, vestidos con el mismo lenguaje visual que el menú de dos
 * niveles, Pacientes y la Agenda.
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de
 * `soporte.module.css` leen esos tokens por herencia. Si el menú cambia de
 * color, Soporte cambia con él: no hay una segunda paleta que mantener.
 *
 * Solo la montan `soporte-client.tsx` y `[id]/ticket-client.tsx` cuando el
 * interruptor por clínica `menu-dos-niveles` (`clinic_feature_flags`) está
 * encendido. Apagado, esos dos archivos pintan la pantalla de siempre, que no
 * comparte ni un nodo con esto: no puede cambiar ni un píxel por culpa de
 * este rediseño.
 *
 * Sin hooks a propósito: es un envoltorio que solo pone clases.
 */
export function RaizSoporte({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[CLASES_MENU, s.raiz, className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

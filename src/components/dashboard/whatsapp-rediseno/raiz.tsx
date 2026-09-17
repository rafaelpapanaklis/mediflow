import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./whatsapp-rediseno.module.css";

/**
 * La raíz del rediseño de WhatsApp (conexión, bot, saldo de IA y plantillas),
 * vestida con el mismo lenguaje visual que el menú de dos niveles, «Hoy»,
 * Pacientes y la Agenda.
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de
 * `whatsapp-rediseno.module.css` leen esos tokens por herencia. Así, si el menú
 * cambia de color, WhatsApp cambia con él, y no hay una segunda paleta que
 * mantener.
 *
 * Solo la montan los cuatro clientes de `src/app/dashboard/whatsapp/` cuando el
 * interruptor por clínica `menu-dos-niveles` (`clinic_feature_flags`) está
 * encendido. Apagado, cada cliente renderiza su JSX de siempre, que no comparte
 * ni un nodo con esto: no puede cambiar ni un píxel por culpa de este rediseño.
 */
export function RaizWhatsApp({ children }: { children: ReactNode }) {
  return <div className={`${CLASES_MENU} ${s.raiz}`}>{children}</div>;
}

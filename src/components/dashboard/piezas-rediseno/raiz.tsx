import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./piezas.module.css";

/**
 * La raíz común del rediseño de Reserva de recursos, Fila de espera
 * (walk-in) y Tratamientos: las tres pantallas cuelgan de aquí y por eso
 * salen en un solo dialecto.
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de
 * `piezas.module.css` leen esos tokens por herencia. Así, si el menú cambia
 * de color, las tres pantallas cambian con él, y no hay una segunda paleta
 * que mantener.
 *
 * Solo la montan los clientes de siempre de cada pantalla cuando el
 * interruptor por clínica `menu-dos-niveles` (`clinic_feature_flags`) está
 * encendido. Apagado, cada cliente pinta su árbol de siempre, que no
 * comparte ni un nodo con esto: no puede cambiar ni un píxel por culpa de
 * este rediseño.
 */
export function RaizRediseno({ children }: { children: ReactNode }) {
  return <div className={`${CLASES_MENU} ${s.raiz}`}>{children}</div>;
}

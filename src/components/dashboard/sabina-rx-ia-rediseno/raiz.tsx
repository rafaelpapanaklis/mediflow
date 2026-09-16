import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./rediseno.module.css";

/**
 * La raíz del rediseño del lote «Sabina · Radiografías · Asistente IA»
 * (ws1-t8): tres pantallas, UNA carpeta de piezas, un solo dialecto.
 *
 * NO declara tokens propios. Monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú de dos niveles —con su versión oscura— y las
 * dos familias tipográficas (Instrument Sans y los íconos). Todas las clases de
 * `rediseno.module.css` leen esos tokens por herencia; lo que el menú no tiene
 * (éxito, alerta, peligro, info) sale de los tokens semánticos de globals.css,
 * los mismos que el propio menú usa de respaldo (`--m2-soporte`).
 *
 * Las tres pantallas se montan con `<RaizRediseno>` SOLO cuando el
 * interruptor por clínica `menu-dos-niveles` (`clinic_feature_flags`) está
 * encendido. Apagado, cada pantalla renderiza exactamente el árbol de siempre
 * con sus clases de siempre: el camino viejo no comparte ni una clase con
 * esto, así que no puede cambiar ni un píxel por culpa del rediseño.
 *
 * Cómo se aplica en cada pantalla (patrón «dos pieles, un esqueleto»): el
 * cliente conserva su JSX y elige el juego de clases con
 * `const c = rediseno ? CLASES_REDISENO : styles`, donde `CLASES_REDISENO`
 * traduce cada clase vieja a una de aquí. El test de la carpeta comprueba que
 * ninguna clase usada se queda sin traducir.
 */
export function RaizRediseno({
  children,
  className,
  ...resto
}: {
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div className={[CLASES_MENU, s.raiz, className ?? ""].filter(Boolean).join(" ")} {...resto}>
      {children}
    </div>
  );
}

/** Las clases de la raíz, para quien las quiera poner en un nodo propio. */
export const CLASES_REDISENO_LOTE = `${CLASES_MENU} ${s.raiz}`;

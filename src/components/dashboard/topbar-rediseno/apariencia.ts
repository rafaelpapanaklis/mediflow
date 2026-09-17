/**
 * La ROPA de las piezas que monta la barra superior (ws1-t6): la paleta de
 * comandos (Ctrl+K), el panel de atajos (?), la campana de avisos, los
 * insights semanales y la alerta de sala de espera.
 *
 * ⛔ Esto no toca ni una regla. Cada pieza es la misma —el mismo estado, el
 * mismo sondeo cada 60 s, la misma búsqueda, los mismos atajos—; lo único que
 * decide la apariencia es con qué estilos se pinta cada elemento.
 *
 * La barra de siempre (`topbar.tsx`) monta las piezas sin decir nada, así que
 * llega `"clasica"`, el valor por defecto, y cada elemento recibe EXACTAMENTE
 * los mismos `style` de antes: ni un píxel distinto. La barra del menú de dos
 * niveles (`topbar-dos-niveles.tsx`, que el layout solo pinta con el
 * interruptor por clínica encendido) pasa `"nueva"`, y las piezas cambian
 * esos `style` por las clases de `piezas-topbar.module.css`, que leen los
 * tokens `--m2-*` del menú.
 *
 * Es el mismo mecanismo que la ventana «Nueva cita»
 * (`new-appointment/apariencia.tsx`): allí va por contexto porque la ventana
 * tiene siete piezas; aquí cada pieza la monta la barra directamente, así que
 * es una prop.
 */

import type { CSSProperties } from "react";

export type AparienciaTopbar = "clasica" | "nueva";

/**
 * A dónde manda «Agenda» cada ropa. Con el diseño nuevo, a la agenda nueva
 * (`/dashboard/agenda`); de siempre, a la de siempre. Lo leen el atajo «G A»,
 * la paleta y la campana, que antes mandaban a la vieja aunque el resto del
 * panel ya fuera el nuevo (auditoría ws1-t8, hallazgos 3 y 11).
 */
export const RUTA_AGENDA: Record<AparienciaTopbar, string> = {
  clasica: "/dashboard/appointments",
  nueva: "/dashboard/agenda",
};

export type Vestir = (
  clasico: CSSProperties | undefined,
  clase: string | undefined,
) => { style?: CSSProperties; className?: string };

/**
 * `vestidor(apariencia)(estiloDeSiempre, claseNueva)` → las props de estilo de
 * un elemento.
 *
 * Con la apariencia clásica (o sin apariencia) devuelve `{ style }` y nada
 * más, así que el elemento recibe EXACTAMENTE lo mismo que antes. Con la
 * nueva devuelve `{ className }` y ningún `style`: un `style` en línea le
 * ganaría a la clase.
 */
export function vestidor(apariencia: AparienciaTopbar | undefined): Vestir {
  const nueva = apariencia === "nueva";
  return (clasico, clase) => (nueva ? { className: clase } : { style: clasico });
}

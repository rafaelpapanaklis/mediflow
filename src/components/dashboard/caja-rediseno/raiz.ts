import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import s from "./caja-rediseno.module.css";

/**
 * Las clases que viste Caja con el diseño nuevo. Se ponen en la raíz de
 * `CajaClient` SOLO cuando la clínica tiene encendido el interruptor
 * `menu-dos-niveles`; sin él la raíz se queda sin clase y la pantalla se
 * pinta exactamente como hoy.
 *
 * `CLASES_REDISENO` es la raíz del rediseño de Pacientes: los tokens
 * `--pr-*` y la misma instancia de Instrument Sans que declara el menú (no
 * descarga otra fuente). Se reutiliza en vez de copiarla para que Caja y
 * Pacientes cambien de color a la vez si un día cambian los tokens.
 * `s.pagina` es lo propio de Caja: cómo esos tokens visten las clases del
 * sistema de diseño que la pantalla ya usaba.
 */
export const CLASES_CAJA_REDISENO = [CLASES_REDISENO, s.pagina].join(" ");

/** Clases sueltas del rediseño para los nodos que las piden a mano. */
export const clasesCaja = s;

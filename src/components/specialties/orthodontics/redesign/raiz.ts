import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import orto from "./orto.module.css";

/**
 * Las clases que lleva la raíz de TODO lo que pinta Ortodoncia: la pestaña de
 * la ficha, cada cajón y las piezas sueltas que se montan fuera de ella (la
 * ranura y el botón de la Agenda).
 *
 * No declara colores: monta los tokens de la ficha (`--pr-*`) y los del menú
 * de dos niveles (`--m2-*`) con su tipografía, y encima la hoja del módulo.
 * Dentro de la ficha esos tokens ya se heredan, pero la Agenda solo presta
 * los suyos, así que cada raíz los monta por su cuenta y el módulo se ve
 * igual esté donde esté.
 */
export const RAIZ_ORTO = [CLASES_REDISENO, CLASES_MENU, orto.raiz].join(" ");

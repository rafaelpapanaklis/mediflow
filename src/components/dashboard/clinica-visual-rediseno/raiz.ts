import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";

/**
 * El rediseño de "Mi Clínica Visual" NO monta un árbol de componentes aparte
 * (a diferencia de Hoy o Agenda): el editor de plano es un solo componente
 * cliente con demasiado estado propio — arrastre, historial de deshacer,
 * autoguardado, modo En Vivo, piso 3D — para duplicarlo con seguridad en dos
 * copias que hay que mantener iguales. En vez de eso, el MISMO
 * `layout-client.tsx` (y sus modales y la sala de espera) recibe una bandera
 * `rediseno` y, cuando está encendida, añade UNA clase marcador a su raíz;
 * las reglas nuevas viven en el propio `.module.css` de cada archivo, bajo
 * ese marcador, y leen `var(--m2-*)`.
 *
 * Este archivo es el único sitio que nombra `CLASES_MENU`: cualquier pieza
 * del rediseño (el marco del editor, los tres modales, la sala de espera)
 * la importa de aquí, nunca del menú directamente.
 */
export const CLASES_REDISENO_CLINICA = CLASES_MENU;

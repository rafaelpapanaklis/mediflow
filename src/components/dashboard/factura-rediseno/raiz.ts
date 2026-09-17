import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./factura-rediseno.module.css";

/**
 * Las clases que visten el detalle de factura y su familia (Reembolsar,
 * Editar precio, Descuento, Cancelar, Timbrar CFDI, «¿Marcar pagada?»,
 * «¿Eliminar borrador?», Registrar pago y Nueva factura) con el diseño nuevo.
 *
 * Van sobre el `DialogContent` de cada modal, y SOLO cuando quien lo monta
 * pasa `rediseno` (que sale del interruptor `menu-dos-niveles` de la
 * clínica, leído en el servidor). Sin él, el modal se queda con la cadena
 * de clases de siempre y se pinta exactamente como hoy.
 *
 * Los modales son portales a <body>: no heredan los tokens de la pantalla
 * que los abre (Caja, la Agenda nueva, el expediente). Por eso la raíz
 * monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`): los `--m2-*` del menú
 * —con su versión oscura— y las dos familias tipográficas. `s.raiz` es lo
 * propio de aquí: cómo esos tokens visten el modal y las piezas del sistema
 * de diseño que ya usaba.
 */
export const CLASES_FACTURA_REDISENO = [CLASES_MENU, s.raiz].join(" ");

/**
 * El popover del calendario (`DateField`) sale a <body> en OTRO portal, fuera
 * del modal: necesita su propia raíz con los tokens.
 */
export const CLASES_CALENDARIO_REDISENO = [CLASES_MENU, s.calendario].join(" ");

/** Clases sueltas del rediseño para los nodos que las piden a mano. */
export const clasesFactura = s;

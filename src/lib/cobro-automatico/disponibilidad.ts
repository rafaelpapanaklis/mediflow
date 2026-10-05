// Configuración → Anticipos → «Cobro automático con tarjeta»: por qué se puede o no se puede encender (ws1-t9, #18).
//
// Antes la sección se callaba del todo sin cuenta de Mercado Pago o sin el SQL pegado: en la revisión de Chrome «no
// apareció el interruptor ni en la ficha ni en Configuración» y nadie podía saber por qué. Ahora siempre hay una
// tarjeta y dice la razón; el interruptor solo se pinta cuando de verdad se puede encender. PURO.

import type { EstadoConfig } from "./servicio.server";

export type DisponibilidadCobroAutomatico =
  | "cargando"
  | "sin-cuenta"
  | "no-disponible"
  | "listo";

/** `estado`: undefined = aún no responde la ruta; null = la ruta falló. */
export function disponibilidadCobroAutomatico(
  cuentaConectada: boolean,
  estado: EstadoConfig | null | undefined,
): DisponibilidadCobroAutomatico {
  if (!cuentaConectada) return "sin-cuenta";
  if (estado === undefined) return "cargando";
  if (estado === null || !estado.tablas) return "no-disponible";
  if (!estado.conectado) return "sin-cuenta";
  return "listo";
}

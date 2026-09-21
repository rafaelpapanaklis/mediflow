// ═══════════════════════════════════════════════════════════════════════════
// ¿La clínica ya abrió nuestra respuesta? — regla ÚNICA para /admin/soporte.
// Módulo puro (sin React, sin prisma): lo comparten la lista, la ficha y el
// test. El dato ya existe y se mantiene solo:
//   · soporte responde        → service.addSupportMessage pone clinicUnread=true
//   · la clínica abre el hilo → service.getTicketForClinic lo pone en false
// Aquí NO se toca esa lógica: solo se traduce a los tres estados que se pintan.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tres estados, no dos. Un ticket al que todavía no hemos respondido NO está
 * "sin leer": no hay nada que leer. Mezclarlos sería mentirle a soporte.
 */
export type EstadoLectura = "sin-respuesta" | "sin-leer" | "leido";

/** Lo mínimo que hace falta del ticket; así el test no arma un DTO entero. */
export interface TicketLectura {
  /** ¿Existe ya una respuesta pública nuestra? (lastSupportMessageAt != null) */
  hasSupportReply: boolean;
  /** true → la clínica aún no ha abierto el hilo desde esa respuesta. */
  clinicUnread: boolean;
}

export function estadoLectura(t: TicketLectura): EstadoLectura {
  // El orden importa: sin respuesta nuestra, clinicUnread no significa nada
  // sobre "leer una respuesta" (changeStatus también lo levanta).
  if (!t.hasSupportReply) return "sin-respuesta";
  return t.clinicUnread ? "sin-leer" : "leido";
}

/** Texto corto de la píldora / celda. */
export const LECTURA_LABEL: Record<EstadoLectura, string> = {
  "sin-respuesta": "Sin respuesta",
  "sin-leer": "Sin leer",
  leido: "Leído",
};

/**
 * Frase completa: tooltip en la lista, texto visible en la ficha.
 *
 * Ojo con la redacción de "sin-leer": `clinicUnread` se levanta con la
 * respuesta (addSupportMessage) Y con el cambio de estado (changeTicketStatus,
 * que además le manda email a la clínica). Si la clínica lee la respuesta y
 * DESPUÉS soporte mueve el estado, vuelve a quedar en true. Por eso aquí se
 * habla de "nuestra última novedad" y no de "nuestra respuesta": lo segundo
 * sería mentira en ese caso. Distinguirlos pediría una fecha de lectura en la
 * tabla, y eso no se añade por cuenta propia (ver reporte).
 */
export const LECTURA_DETALLE: Record<EstadoLectura, string> = {
  "sin-respuesta": "Todavía no le hemos respondido: no hay nada que la clínica pueda leer.",
  "sin-leer": "La clínica NO ha abierto el ticket desde nuestra última novedad (respuesta o cambio de estado).",
  leido: "La clínica abrió el ticket después de nuestra última novedad.",
};

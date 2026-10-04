// C-114 (ws1-t8, auditoría de uso; decisión 10 de Rafael): una clínica
// OCULTA («Clínica privada» en Configuración → Mi clínica) también cierra su
// reserva web (/reservar/<slug> y el widget de su página). Puro: sin base.
//
// Criterio conservador (ver reporte, vuelta 2): las 17 clínicas activas ya
// están «privadas» por defecto y recibieron 37 citas por la web en 90 días.
// Cerrarles la reserva de golpe, sin que lo sepan, rompería algo que usan.
// Por eso el cierre ocurre AL OCULTAR (al pasar de pública a privada, y desde
// la pantalla, al apagar el interruptor de pública), queda a la vista como un
// interruptor propio «Reserva web en línea» y se puede reabrir a propósito.
// Las que ya estaban privadas siguen abiertas hasta que alguien lo decida, y
// la pantalla les avisa que «oculta» no estaba cerrando su reserva.

export interface EntradaReservaWeb {
  /** isPublic antes de guardar. */
  eraPublica: boolean;
  /** isPublic después de guardar. */
  esPublica: boolean;
  /** Lo guardado hasta ahora (true si la columna aún no existe). */
  abierta: boolean;
  /** Lo que mandó la pantalla, si lo mandó. */
  pedida?: unknown;
}

/** Cómo queda la reserva web tras guardar Mi clínica. */
export function reservaTrasGuardar(e: EntradaReservaWeb): boolean {
  if (typeof e.pedida === "boolean") return e.pedida;
  if (e.eraPublica && !e.esPublica) return false; // ocultar cierra (decisión 10)
  return e.abierta;
}

/** El valor que la pantalla propone al mover el interruptor de pública/privada. */
export function reservaAlCambiarVisibilidad(nuevaPublica: boolean, abierta: boolean): boolean {
  return nuevaPublica ? abierta : false;
}

export const MENSAJE_RESERVA_CERRADA = {
  es: "Esta clínica no recibe reservas en línea por ahora. Llámala o escríbele para agendar.",
  en: "This clinic isn't taking online bookings right now. Call or message them to book.",
} as const;

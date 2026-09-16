// Formateadores de la pantalla de Soporte rediseñada. Dicen EXACTAMENTE lo mismo
// que los de `soporte-client.tsx` y `[id]/ticket-client.tsx` (que no se exportan
// y no se tocan): misma salida, mismo idioma, mismos casos vacíos.

/** «16 sep, 13:02» — la última actividad de un ticket en la lista. */
export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** «16 de septiembre de 2026» — la fecha de creación en la cabecera del ticket. */
export function fechaLarga(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

/** Hora de un mensaje del hilo; añade el año solo si no es el actual. */
export function horaMensaje(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  if (d.getFullYear() !== ahora.getFullYear()) opts.year = "numeric";
  return d.toLocaleString("es-MX", opts);
}

/** Tamaño de un adjunto en la lista de nuevos tickets («1.2 MB», «340 KB», «12 B»). */
export function bytesLista(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Tamaño de un adjunto en el hilo: vacío si no se sabe, nunca «0 KB». */
export function bytesHilo(n: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tono visual de cada estado, el MISMO mapa que la pantalla de siempre. */
export type Tono = "exito" | "alerta" | "peligro" | "info" | "marca" | "neutro";

export const TONO_ESTADO: Record<string, Tono> = {
  ABIERTO: "info",
  EN_PROGRESO: "marca",
  ESPERANDO_RESPUESTA: "alerta",
  RESUELTO: "exito",
  CERRADO: "neutro",
};

export const TONO_PRIORIDAD: Record<string, Tono> = {
  URGENTE: "peligro",
  ALTA: "alerta",
  NORMAL: "neutro",
  BAJA: "neutro",
};

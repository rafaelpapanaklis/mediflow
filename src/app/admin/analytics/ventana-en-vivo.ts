/**
 * El texto de la ventana «en vivo», DERIVADO de la constante — nunca escrito
 * a mano.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 * `overview-tab` rotulaba el KPI «En vivo» con la cadena literal
 * `"últimos 5 min"`. Nunca fue cierta: con `LIVE_WINDOW_MS = 75 s` mentía por
 * exceso, y al subir la ventana a 150 s siguió mintiendo (ahora son 2,5 min).
 * `live-tab` sí leía `data?.windowSeconds`, pero su valor por defecto estaba
 * clavado en `75`, así que mentía justo cuando la API no contestaba.
 *
 * La fuente única es `LIVE_WINDOW_MS` (@/lib/analytics/constants), que es la
 * misma que usan `/api/admin/analytics` y `/api/admin/analytics/live` para
 * contar. Mientras el rótulo salga de aquí, mover la ventana no puede volver a
 * desincronizar el texto.
 *
 * Módulo PURO: sin React y sin `server-only`, para poder probarlo con
 * `npm run test:ventana-en-vivo` sin montar la pantalla.
 */
import { LIVE_WINDOW_MS } from "@/lib/analytics/constants";

/** La ventana en segundos, que es la unidad en la que la API la publica. */
export const VENTANA_EN_VIVO_S = Math.round(LIVE_WINDOW_MS / 1000);

/**
 * Por debajo de esto se dicen segundos. 90 s y no 60 s a propósito: "90 s" se
 * lee mejor que "1,5 min", y el salto a minutos cae en un número redondo.
 */
const UMBRAL_MINUTOS_S = 90;

/**
 * Duración legible en español de México: coma decimal, un decimal como mucho y
 * sin el ",0" cuando la cifra es entera.
 *
 *   45  → "45 s"      ·  90  → "1,5 min"
 *   150 → "2,5 min"   ·  300 → "5 min"
 *
 * Se acepta el argumento en vez de leer la constante directamente para poder
 * probar los tramos; el valor por defecto es el bueno.
 */
export function duracionVentana(segundos: number = VENTANA_EN_VIVO_S): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return "0 s";
  if (segundos < UMBRAL_MINUTOS_S) return `${Math.round(segundos)} s`;
  const minutos = Math.round((segundos / 60) * 10) / 10;
  return `${String(minutos).replace(".", ",")} min`;
}

/** Rótulo corto del KPI «En vivo»: «últimos 2,5 min». */
export function rotuloVentanaEnVivo(segundos: number = VENTANA_EN_VIVO_S): string {
  return `últimos ${duracionVentana(segundos)}`;
}

/** Línea larga de la pestaña «En vivo»: «Activos en los últimos 2,5 min». */
export function fraseVentanaEnVivo(segundos: number = VENTANA_EN_VIVO_S): string {
  return `Activos en los ${rotuloVentanaEnVivo(segundos)}`;
}

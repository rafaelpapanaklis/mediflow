/**
 * IDs de los modelos de Anthropic que consume la app, en UN solo lugar.
 *
 * Existe porque la pantalla del chat mostraba "claude-sonnet-4-6" hardcodeado
 * mientras el endpoint corría en Haiku: la etiqueta que ve la clínica y el
 * modelo que de verdad responde pueden divergir sin que nada lo note. Toda UI
 * que muestre el modelo debe leerlo de aquí, nunca escribirlo a mano.
 *
 * Los análisis CLÍNICOS (consulta, radiografías, contraindicaciones) corren en
 * Claude Sonnet y cada ruta declara su propio MODEL: no se centralizan aquí
 * porque ninguna pantalla los muestra todavía.
 */

/** Chat del asistente (POST /api/ai): respuestas cortas, rápido y económico. */
export const AI_CHAT_MODEL = "claude-haiku-4-5-20251001";

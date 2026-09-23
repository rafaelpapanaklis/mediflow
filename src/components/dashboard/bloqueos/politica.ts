/**
 * ¿SE PUEDE AGENDAR SOBRE UN DÍA BLOQUEADO? — el interruptor por clínica.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DE DÓNDE SALE
 *
 * Se decidió que al staff se le AVISA y se le deja agendar sobre un bloqueo,
 * con confirmación y rastro en `AuditLog` (`confirmar-bloqueo.tsx`). Un
 * cliente pidió lo contrario: que ni recepción ni la IA puedan. Las dos cosas
 * son razonables según la clínica, así que es un ajuste de la clínica, en
 * Configuración → Horarios y bloqueos, y de fábrica en «Sí»: las clínicas que
 * ya lo usan no pueden cambiar de comportamiento solas.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EL ENDPOINT — `src/app/api/settings/bloqueos/politica/route.ts` (WS1-T5)
 *
 * Hasta WS1-T5 no existía: «politica» caía en `[id]`, que lo tomaba por el
 * id de un bloqueo, y la tarjeta salía con «No se pudo leer este ajuste». El
 * valor vive en `agenda_block_policies` (una fila por clínica; sin fila =
 * «Sí»), y lo lee y guarda `src/lib/agenda-bloqueos/politica.server.ts`.
 *
 *     GET  /api/settings/bloqueos/politica          (agenda.view)
 *       → { recepcionPuedeAgendar: boolean, puedoAgendarEncima: boolean }
 *     PUT  /api/settings/bloqueos/politica          (settings.edit)
 *       ← { recepcionPuedeAgendar: boolean }
 *       → la misma forma que el GET
 *     errores: { error: "CODIGO", mensaje: "frase" }
 *
 *   · `recepcionPuedeAgendar` — el ajuste de la clínica, tal cual. De
 *     fábrica `true`.
 *   · `puedoAgendarEncima` — lo que vale PARA QUIEN PREGUNTA, resuelto en el
 *     servidor. Es lo que lee la ventana de confirmar: la pantalla no sabe el
 *     rol de quien agenda y no lo vuelve a razonar (mismo criterio que
 *     `puedoRetirarlo` en `BloqueoDTO`). A quién alcanza el «No» se decide
 *     allí, en un solo sitio (`puedeAgendarEncima`, agenda-bloqueos/core.ts):
 *     a todo el que no tenga `settings.edit` — recepción, doctores y Sabina.
 *
 * Y el candado de verdad es el servidor: con «No», el POST/PATCH de la cita
 * sobre un bloqueo se rechaza con 422 `blocked_slot_not_allowed` y su frase
 * en `reason`. Esconder el botón no es prohibir.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const RUTA_POLITICA = "/api/settings/bloqueos/politica";

export interface PoliticaBloqueos {
  recepcionPuedeAgendar: boolean;
  puedoAgendarEncima: boolean;
}

/** Lo que vale mientras el servidor no diga otra cosa: el comportamiento de hoy. */
export const POLITICA_DE_FABRICA: PoliticaBloqueos = {
  recepcionPuedeAgendar: true,
  puedoAgendarEncima: true,
};

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * La respuesta del servidor, o `null` si no se entiende.
 *
 * Solo un `false` explícito prohíbe. Cualquier otra cosa —el campo ausente,
 * un `null`, un endpoint que todavía no existe— cae a «Sí», que es lo de
 * fábrica y lo de hoy. Un aviso que no se pudo leer nunca puede impedir
 * agendar: si la clínica dijo «No», el servidor lo rechaza con su frase.
 */
export function parsePolitica(raw: unknown): PoliticaBloqueos | null {
  if (!esObjeto(raw)) return null;
  if (!("recepcionPuedeAgendar" in raw) && !("puedoAgendarEncima" in raw)) return null;
  return {
    recepcionPuedeAgendar: raw.recepcionPuedeAgendar !== false,
    puedoAgendarEncima: raw.puedoAgendarEncima !== false,
  };
}

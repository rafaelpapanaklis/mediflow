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
 * ⚠️ PENDIENTE DE ws1-t2 — ESTE ENDPOINT TODAVÍA NO EXISTE
 *
 * No hay ningún campo en la base para esto, ni en `Clinic` ni en la lista
 * blanca de `/api/settings`, y esta pantalla NO lo inventa (no toca
 * `prisma/`). Lo que la pantalla pide, y contra lo que está hecha:
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
 *     `puedoRetirarlo` en `BloqueoDTO`). A quién alcanza el «No» —recepción y
 *     la IA seguro; doctor y administración, lo que decida el servidor— se
 *     decide allí, en un solo sitio.
 *
 * Y el candado de verdad es el servidor: con «No», el POST/PATCH de la cita
 * sobre un bloqueo tiene que rechazarse con su `mensaje`. Esconder el botón
 * no es prohibir.
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

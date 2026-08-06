// Borradores del composer del Inbox, POR HILO — lógica pura (hallazgo M-01).
//
// El composer es uno solo para todas las conversaciones. Sin esto, el texto
// escrito para un paciente seguía en pantalla al saltar a otra conversación
// —y el modo volvía a "Responder"—, de modo que una nota interna sobre Ana
// podía salir por WhatsApp al teléfono de Beto.
//
// Vive fuera del componente para poder testear las transiciones sin montar
// React (el repo no tiene testing-library): npm run test:inbox-drafts.

export type ComposerMode = "reply" | "internal";
export type ComposerDraft = { text: string; mode: ComposerMode };

/** Lo que ve un hilo del que nadie ha escrito nada todavía. */
export const EMPTY_DRAFT: ComposerDraft = { text: "", mode: "reply" };

/** Tope de borradores vivos en memoria (se sueltan los menos recientes). */
export const MAX_DRAFTS = 40;

export type DraftMap = Record<string, ComposerDraft>;
export type DraftPatch =
  | Partial<ComposerDraft>
  | ((prev: ComposerDraft) => Partial<ComposerDraft>);

/** El borrador de un hilo, o el vacío por defecto (nunca undefined). */
export function getDraft(drafts: DraftMap, threadId: string | null | undefined): ComposerDraft {
  return (threadId ? drafts[threadId] : null) ?? EMPTY_DRAFT;
}

/**
 * Escribe el borrador de UN hilo concreto (nunca "el activo"): el envío es
 * asíncrono y el usuario puede haber saltado a otra conversación mientras
 * tanto — limpiar "el activo" borraría el borrador del hilo equivocado.
 *
 * Devuelve el MISMO objeto si nada cambia (para que React no re-renderice).
 */
export function applyDraft(drafts: DraftMap, threadId: string, patch: DraftPatch): DraftMap {
  const current = drafts[threadId] ?? EMPTY_DRAFT;
  const next: ComposerDraft = {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
  if (next.text === current.text && next.mode === current.mode) return drafts;

  const rest = omit(drafts, threadId);
  // Sin texto y en modo respuesta = el default: no hay nada que recordar.
  if (!next.text && next.mode === "reply") return rest;
  // Reinsertar al final ordena por uso reciente; sobre el tope se sueltan los
  // más viejos para que el mapa no crezca sin límite. Los ids son cuid (nunca
  // enteros), así que Object.keys respeta el orden de inserción.
  rest[threadId] = next;
  const keys = Object.keys(rest);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DRAFTS))) delete rest[k];
  return rest;
}

/** Olvida por completo el borrador de un hilo (al resolverlo/archivarlo). */
export function dropDraft(drafts: DraftMap, threadId: string): DraftMap {
  if (!(threadId in drafts)) return drafts;
  return omit(drafts, threadId);
}

/**
 * Al ABANDONAR un hilo, olvida su borrador si quedó sin texto.
 *
 * Recordar el modo "Nota interna" con el texto vacío no preserva nada del
 * trabajo del usuario y sí cambia el destino del siguiente mensaje: al volver
 * a ese hilo, una respuesta escrita para el paciente se guardaría como nota
 * interna y él nunca la recibiría. Un borrador vacío en modo nota no vale lo
 * que cuesta.
 *
 * Se hace al salir y no al vaciar el texto a propósito: mientras la
 * conversación está en pantalla, borrar lo escrito NO debe mover el selector
 * bajo los dedos de quien escribe (ese salto a "Responder" sería justo el
 * camino por el que una nota acaba saliendo al paciente).
 */
export function forgetEmptyDraft(drafts: DraftMap, threadId: string): DraftMap {
  const draft = drafts[threadId];
  // `trim()` a propósito: un borrador de solo espacios no se puede ni enviar
  // (el composer exige texto real), pero arrastraría el modo consigo.
  if (!draft || draft.text.trim()) return drafts;
  return omit(drafts, threadId);
}

/* Copia sin una clave, conservando el orden de inserción del resto. */
function omit(drafts: DraftMap, threadId: string): DraftMap {
  const rest: DraftMap = {};
  for (const k of Object.keys(drafts)) if (k !== threadId) rest[k] = drafts[k];
  return rest;
}

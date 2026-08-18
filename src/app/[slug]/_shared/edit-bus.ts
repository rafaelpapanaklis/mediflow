/* ============================================================
   EL CANAL DE VUELTA: del iframe al editor.

   La vista previa en vivo (live-preview.tsx) ya lleva el sentido
   editor → iframe: un parche con lo que la clínica escribe en el
   formulario. El editor visual necesita el sentido contrario, porque
   ahora se escribe DENTRO del lienzo.

   Mismo origen, misma marca (LIVE_PREVIEW_MSG) y mismo criterio de
   multi-inquilino (el slug tiene que coincidir). Lo que viaja:

     iframe → editor
       edit        · terminé de escribir este campo
       photo       · suelta o elige esta foto para esta ranura
       photo-clear · quita la foto de esta ranura
       aviso       · algo que contarle a la clínica (un archivo que no
                     es imagen, por ejemplo)

     editor → iframe
       photo-ok    · ya subió; suelta la vista previa local
       photo-fail  · no subió; vuelve a la publicada

   La DIRECCIÓN del campo ("sec:servicios:titulo") viaja como texto y
   se traduce del otro lado con @/lib/landing-address, que solo
   entiende un juego cerrado de formas. Aquí no se interpreta nada.

   Sin "use client": lo importan el runtime (dentro del iframe) y el
   editor (fuera).
   ============================================================ */
import { LIVE_PREVIEW_MSG } from "./live-preview";

export type MensajeDeEdicion =
  | { source: typeof LIVE_PREVIEW_MSG; kind: "edit";        slug: string; campo: string; valor: string | null }
  | { source: typeof LIVE_PREVIEW_MSG; kind: "photo";       slug: string; slot: string; file: File }
  | { source: typeof LIVE_PREVIEW_MSG; kind: "photo-clear"; slug: string; slot: string }
  | { source: typeof LIVE_PREVIEW_MSG; kind: "aviso";       slug: string; texto: string };

export type RespuestaDeFoto =
  | { source: typeof LIVE_PREVIEW_MSG; kind: "photo-ok";   slug: string; slot: string }
  | { source: typeof LIVE_PREVIEW_MSG; kind: "photo-fail"; slug: string; slot: string };

/**
 * El mensaje sin el sobre (source + slug), que los pone el emisor.
 *
 * Distributivo (`T extends any ? … : never`): un `Omit` a secas sobre una
 * unión colapsa las variantes en sus claves comunes, y entonces `{kind:"edit",
 * campo, valor}` deja de compilar porque `campo` "no existe" en la mezcla.
 */
type SinSobre<T> = T extends unknown ? Omit<T, "source" | "slug"> : never;

/** Tope de la etiqueta de un aviso; es texto que se pinta en el editor. */
const MAX_AVISO = 300;
/** Tope de un texto editado. El PATCH ya acota por columna; esto corta antes. */
const MAX_VALOR = 5000;

function comun(ev: MessageEvent, slug: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  if (ev.origin !== window.location.origin) return null;
  const d = ev.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  if (d.source !== LIVE_PREVIEW_MSG) return null;
  // Multi-inquilino: la vista previa es la de ESTA clínica y de ninguna otra.
  if (d.slug !== slug) return null;
  return d;
}

/**
 * Lo que el EDITOR acepta del iframe. null = no es nuestro o viene roto.
 *
 * Se valida la forma, no solo el tipo: `campo` se traduce después contra
 * un juego cerrado de direcciones, y `file` tiene que ser un File de
 * verdad (postMessage clona el objeto, así que llega uno nativo).
 */
export function leerMensajeDeEdicion(ev: MessageEvent, slug: string): MensajeDeEdicion | null {
  const d = comun(ev, slug);
  if (!d) return null;

  if (d.kind === "edit") {
    if (typeof d.campo !== "string") return null;
    if (d.valor !== null && typeof d.valor !== "string") return null;
    if (typeof d.valor === "string" && d.valor.length > MAX_VALOR) return null;
    return d as MensajeDeEdicion;
  }
  if (d.kind === "photo") {
    if (typeof d.slot !== "string") return null;
    if (!(d.file instanceof File)) return null;
    return d as unknown as MensajeDeEdicion;
  }
  if (d.kind === "photo-clear") {
    if (typeof d.slot !== "string") return null;
    return d as unknown as MensajeDeEdicion;
  }
  if (d.kind === "aviso") {
    if (typeof d.texto !== "string" || d.texto.length > MAX_AVISO) return null;
    return d as unknown as MensajeDeEdicion;
  }
  return null;
}

/** Lo que el IFRAME acepta del editor (además del parche de live-preview). */
export function leerRespuestaDeFoto(ev: MessageEvent, slug: string): RespuestaDeFoto | null {
  const d = comun(ev, slug);
  if (!d) return null;
  if (d.kind !== "photo-ok" && d.kind !== "photo-fail") return null;
  if (typeof d.slot !== "string") return null;
  return d as unknown as RespuestaDeFoto;
}

/** Manda al editor desde dentro del iframe. Sin padre, no hace nada. */
export function avisarAlEditor(slug: string, m: SinSobre<MensajeDeEdicion>) {
  if (typeof window === "undefined") return;
  try {
    window.parent?.postMessage(
      { ...m, source: LIVE_PREVIEW_MSG, slug },
      window.location.origin,
    );
  } catch {
    /* Sin padre o de otro origen: el lienzo se queda con lo que ya pintó. */
  }
}

/** Manda al iframe desde el editor. */
export function responderAlLienzo(win: Window | null | undefined, slug: string, m: SinSobre<RespuestaDeFoto>) {
  if (!win || typeof window === "undefined") return;
  try {
    win.postMessage({ ...m, source: LIVE_PREVIEW_MSG, slug }, window.location.origin);
  } catch {
    /* El iframe se recargó: la vista previa local se cae sola al remontar. */
  }
}

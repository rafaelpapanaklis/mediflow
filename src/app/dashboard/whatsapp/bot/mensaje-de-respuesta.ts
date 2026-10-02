// Frases de error de la pantalla del bot de WhatsApp. Puro (sin React): `t` es
// la función del i18n y se pasa desde el componente; así se prueba de verdad.
import { mensajeDeError, type Traductor } from "@/lib/errores/mensaje-de-error";

// Mensaje único de "sin permiso": lo usan el gate del cliente y el 403 del
// servidor, para que la clínica lea lo mismo venga de donde venga.
export const SIN_PERMISO = "No tienes permiso para configurar el bot de WhatsApp";

/** Un error cuyo texto ya pasó por `mensajeDeError`: se enseña tal cual, sin traducirlo otra vez. */
export class ErrorLegible extends Error {}

/**
 * La frase para una respuesta que no salió bien. El servidor puede mandar JSON
 * (`{ error }`, con código o con frase) o texto plano («Internal Server Error»):
 * pasa por `mensajeDeError`, así que a la clínica nunca le llega el texto crudo
 * ni en inglés. Un 403 se dice con las palabras de esta pantalla.
 */
export async function mensajeDeRespuestaBot(
  res: { status: number; text: () => Promise<string> },
  t: Traductor,
  porDefecto: string,
): Promise<string> {
  if (res.status === 403) return SIN_PERMISO;
  const crudo = (await res.text().catch(() => "")).trim();
  let cuerpo: unknown = crudo;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    // texto plano: se queda como string
  }
  return mensajeDeError(cuerpo, t, { estado: res.status, porDefecto });
}

/** Lo que se enseña en el toast de un `catch`: lo ya traducido, o el error pasado por `mensajeDeError` (p. ej. «Failed to fetch»). */
export function mensajeDeCatch(err: unknown, t: Traductor, porDefecto: string): string {
  return err instanceof ErrorLegible ? err.message : mensajeDeError(err, t, { porDefecto });
}

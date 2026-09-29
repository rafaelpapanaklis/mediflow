// Equipo — leer la respuesta de /api/team/** sin exponer texto técnico.
//
// Producción mostró «Unexpected end of JSON input» al eliminar un doctor: el
// servidor contestó sin cuerpo y `res.json()` reventó. Quien pulsa el botón no
// puede hacer nada con ese texto. Aquí una respuesta vacía o que no es JSON se
// vuelve un mensaje entendible, y el cuerpo con `error` sigue diciendo su causa.

export const MENSAJE_RESPUESTA_ROTA = "No se pudo completar. Intenta de nuevo o desactiva al miembro.";

/** Cuerpo → objeto, o `null` si está vacío o no es JSON (nunca lanza). */
export function parsearCuerpo(texto: string): Record<string, any> | null {
  if (!texto || !texto.trim()) return null;
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" ? (v as Record<string, any>) : null;
  } catch {
    return null;
  }
}

/**
 * Lee la respuesta. Con éxito devuelve el objeto (`{}` si vino vacío). Si el
 * estado NO es 2xx lanza un Error cuyo mensaje es el `error` del servidor o, si
 * la respuesta no trae JSON, `MENSAJE_RESPUESTA_ROTA`.
 */
export async function leerRespuestaEquipo(res: Response): Promise<Record<string, any>> {
  const cuerpo = parsearCuerpo(await res.text().catch(() => ""));
  if (!res.ok) {
    const causa = cuerpo && typeof cuerpo.error === "string" && cuerpo.error.trim() ? cuerpo.error : MENSAJE_RESPUESTA_ROTA;
    throw new Error(causa);
  }
  return cuerpo ?? {};
}

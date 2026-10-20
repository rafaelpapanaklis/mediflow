/* ============================================================
   La sesión con que una pestaña abrió al paciente (ws1-t11, revisión t8,
   cuarta vuelta, N4-O2).

   El autoguardado del odontograma manda cada escritura con la sesión de la
   cola (usuario y sede con que se pintó la página) en una cabecera. La cookie
   es una sola para todo el navegador: si en otra pestaña entró otro usuario o
   se cambió de sede, la cookie ya no es la de quien marcó. El servidor compara
   y, si no coinciden, responde 409 `otra_sesion` SIN escribir. Así no sale
   nada firmado por otro ni a otra sede — tampoco por keepalive al cerrar, que
   no da tiempo a preguntar antes.

   Sin la cabecera (otras pantallas, JS de antes) no se compara nada.
   Sin dependencias: lo importan el cliente y las rutas.
   ============================================================ */

export const CABECERA_SESION_ODONTOGRAMA = "x-odontograma-sesion";

/** Valor de la cabecera para una sesión. */
export function valorCabeceraSesion(s: { userId: string; clinicId: string }): string {
  return `${encodeURIComponent(s.userId)}|${encodeURIComponent(s.clinicId)}`;
}

/**
 * ¿La petición dice venir de una sesión distinta a la de la cookie? Sin
 * cabecera, no (no hay con qué comparar). Una cabecera ilegible cuenta como
 * distinta: mejor no escribir.
 */
export function sesionDistinta(
  headers: { get(name: string): string | null },
  user: { id: string; clinicId: string | null | undefined },
): boolean {
  const v = headers.get(CABECERA_SESION_ODONTOGRAMA);
  if (!v) return false;
  const partes = v.split("|");
  if (partes.length !== 2) return true;
  try {
    const [u, c] = partes.map(decodeURIComponent);
    return u !== user.id || !user.clinicId || c !== user.clinicId;
  } catch {
    return true;
  }
}

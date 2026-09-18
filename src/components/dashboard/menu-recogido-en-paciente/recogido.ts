/**
 * Menú recogido al abrir la ficha de un paciente (pedido de Rafael, ws1-t4).
 *
 * Lógica PURA, sin React, para que se pueda probar sola. El hook que la usa
 * está en use-encogido-en-ficha.ts; el menú de dos niveles la enchufa en
 * UNA línea (menu-dos-niveles.tsx).
 *
 * Las reglas:
 *  1. Dentro de la ficha (/dashboard/patients/<id> y lo que cuelgue de ahí),
 *     el menú sale recogido a iconos, para ganar ancho donde más falta hace.
 *  2. Fuera de la ficha manda la preferencia de la persona (el botón de
 *     recoger/desplegar, guardada en localStorage), que NO se toca aquí.
 *  3. Dentro de la ficha se puede volver a desplegar a mano. Esa elección es
 *     de ESA visita a ESE paciente: no pisa la preferencia, así que al salir
 *     el menú vuelve exactamente como la persona lo tenía; y al abrir otro
 *     paciente (o volver a abrir el mismo desde la lista) se recoge otra vez.
 *
 * Solo la ficha de Pacientes. Las pantallas de especialidad
 * (/dashboard/specialties/<x>/<patientId>) y radiografías (/dashboard/xrays)
 * no cambian: «no cambies el menú en ninguna otra pantalla».
 */

const FICHA = /^\/dashboard\/patients\/([^/?#]+)(?:[/?#]|$)/;

/**
 * El id del paciente si la ruta es su ficha (o una pantalla dentro de ella,
 * como /orthodontics); null en cualquier otra pantalla, la lista de
 * pacientes incluida.
 */
export function pacienteDeFicha(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const m = FICHA.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

export const esFichaDePaciente = (pathname: string | null | undefined) => pacienteDeFicha(pathname) !== null;

/**
 * Cómo se pinta el menú:
 *  - fuera de la ficha: la preferencia de la persona, tal cual;
 *  - en la ficha sin haber tocado el botón: recogido;
 *  - en la ficha tras tocar el botón: lo que eligió en esta visita.
 */
export function encogidoEfectivo(
  preferencia: boolean,
  enFicha: boolean,
  eleccionEnFicha: boolean | null,
): boolean {
  if (!enFicha) return preferencia;
  return eleccionEnFicha ?? true;
}

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
 *
 * Y, desde el 28-sep-2026, el módulo de Ortodoncia (pedido de Rafael, ws1-t3:
 * «que ortodoncia al darle click y cargue se esconda el menú completamente
 * igual que cuando abres un paciente»). /dashboard/orthodontics y todo lo que
 * cuelga de ahí es una ZONA más, con las mismas tres reglas: entra recogido,
 * se puede desplegar a mano sin pisar la preferencia, y al salir el menú
 * vuelve como estaba. La zona es el módulo ENTERO, no cada pestaña: pasar de
 * Tablero a Cobranza no vuelve a recoger lo que la persona desplegó. La
 * pantalla vieja /dashboard/specialties/orthodontics sigue sin cambiar.
 */

const FICHA = /^\/dashboard\/patients\/([^/?#]+)(?:[/?#]|$)/;
const MODULO_ORTODONCIA = /^\/dashboard\/orthodontics(?:[/?#]|$)/;
// La página de contratar vive dentro de la ruta del módulo, pero NO es el
// módulo: es una página de compra, no un sitio de trabajo. Ahí el menú se
// queda como la persona lo tiene.
const CONTRATAR_ORTODONCIA = /^\/dashboard\/orthodontics\/contratar(?:[/?#]|$)/;

/** La zona del módulo de Ortodoncia. No choca con un paciente: esas llevan `paciente:` delante. */
export const ZONA_ORTODONCIA = "modulo:ortodoncia";

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
 * La zona donde el menú sale recogido, o null si en esa pantalla manda la
 * preferencia. Cada ficha es su propia zona (`paciente:<id>`) y el módulo de
 * Ortodoncia es una sola. Es la clave a la que el hook ata la elección hecha
 * a mano: cambia la zona y la elección se olvida.
 */
export function zonaRecogida(pathname: string | null | undefined): string | null {
  const paciente = pacienteDeFicha(pathname);
  if (paciente !== null) return `paciente:${paciente}`;
  if (pathname && MODULO_ORTODONCIA.test(pathname) && !CONTRATAR_ORTODONCIA.test(pathname)) return ZONA_ORTODONCIA;
  return null;
}

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

/**
 * ¿Hay que cerrar el segundo nivel del menú (Administración) al cambiar de
 * pantalla? Solo al ENTRAR al módulo de Ortodoncia desde fuera.
 *
 * Por qué hace falta: a la ficha se llega desde Pacientes, que está en el
 * primer nivel, así que recoger ese nivel ya deja solo la barra de iconos.
 * Ortodoncia vive DENTRO del segundo nivel (Administración → Especialidades):
 * sin esto, al hacer clic se recogía la barra y el panel de 248 px se quedaba
 * acoplado, o sea que el menú seguía ahí. Cerrarlo al entrar es lo que deja
 * la pantalla igual que la ficha.
 *
 * Solo al entrar: moverse entre pestañas del módulo no cierra nada, así que
 * quien vuelva a abrir Administración estando dentro lo conserva abierto.
 */
export function cierraSegundoNivelAlEntrar(
  anterior: string | null | undefined,
  actual: string | null | undefined,
): boolean {
  return zonaRecogida(actual) === ZONA_ORTODONCIA && zonaRecogida(anterior) !== ZONA_ORTODONCIA;
}

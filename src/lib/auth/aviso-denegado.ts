// C-109 (ws1-t8, auditoría de uso): `requirePermissionOrRedirect` manda a
// `/dashboard?denied=<key>` y nadie leía ese parámetro: la persona aterrizaba
// en Hoy sin saber por qué, con la llave técnica en la barra de direcciones.
// Aquí, puro (sin React ni Next), lo que se le dice y la dirección limpia.

import { ALL_PERMISSIONS, type PermissionKey } from "./permissions";

export const PARAMETRO_DENEGADO = "denied";

/** El aviso del rebote, o null si el parámetro no es una llave conocida. */
export function mensajeDeRebote(llave: string | null | undefined, locale: string = "es"): string | null {
  if (!llave || !Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, llave)) return null;
  const permiso = ALL_PERMISSIONS[llave as PermissionKey];
  return locale.startsWith("en")
    ? `You can't open that screen: your role doesn't have «${permiso}». Ask the clinic owner for it.`
    : `No puedes abrir esa pantalla: tu rol no tiene «${permiso}». Pídeselo al dueño/a de la clínica.`;
}

/** La misma dirección sin `?denied=` (conserva el resto de parámetros y el #). */
export function direccionSinDenegado(href: string): string {
  const m = href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  if (!m) return href;
  const [, ruta, consulta = "", ancla = ""] = m;
  const resto = consulta
    .replace(/^\?/, "")
    .split("&")
    .filter((par) => par !== "" && par.split("=")[0] !== PARAMETRO_DENEGADO);
  return `${ruta}${resto.length ? `?${resto.join("&")}` : ""}${ancla}`;
}

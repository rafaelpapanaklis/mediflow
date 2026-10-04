// C-109 (ws1-t8, auditoría de uso): `requirePermissionOrRedirect` manda a
// `/dashboard?denied=<key>` y nadie leía ese parámetro: la persona aterrizaba
// en Hoy sin saber por qué, con la llave técnica en la barra de direcciones.
// Aquí, puro (sin React ni Next), lo que se le dice y la dirección limpia.

import { ALL_PERMISSIONS, type PermissionKey } from "./permissions";

export const PARAMETRO_DENEGADO = "denied";

/**
 * C-109 (vuelta 3): pantallas que no se cierran por un permiso sino por ROL
 * (Bitácora, Firma, Sucursales, Mi Clínica Visual) rebotaban sin aviso.
 * Rebotan con `?denied=rol:<quién>` y se les dice lo mismo, con otras palabras.
 */
export const REBOTE_POR_ROL = {
  admin: "rol:admin",
  dueno: "rol:dueno",
  clinico: "rol:clinico",
} as const;

const MENSAJE_POR_ROL: Record<string, { es: string; en: string }> = {
  [REBOTE_POR_ROL.admin]: {
    es: "Esa pantalla es solo para el dueño/a y los administradores de la clínica. Si la necesitas, pídele acceso al dueño/a.",
    en: "That screen is only for the clinic owner and administrators. If you need it, ask the owner for access.",
  },
  [REBOTE_POR_ROL.dueno]: {
    es: "Esa pantalla es solo para el dueño/a de la cuenta.",
    en: "That screen is only for the account owner.",
  },
  [REBOTE_POR_ROL.clinico]: {
    es: "Esa pantalla es para el personal clínico (doctores) y la administración de la clínica.",
    en: "That screen is for clinical staff (doctors) and the clinic's administration.",
  },
};

/** La dirección a la que se rebota por rol. */
export function direccionDeRebotePorRol(quien: keyof typeof REBOTE_POR_ROL): string {
  return `/dashboard?${PARAMETRO_DENEGADO}=${encodeURIComponent(REBOTE_POR_ROL[quien])}`;
}

/** El aviso del rebote, o null si el parámetro no es una llave conocida. */
export function mensajeDeRebote(llave: string | null | undefined, locale: string = "es"): string | null {
  if (llave && MENSAJE_POR_ROL[llave]) return MENSAJE_POR_ROL[llave][locale.startsWith("en") ? "en" : "es"];
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

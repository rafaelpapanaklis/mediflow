// ═══════════════════════════════════════════════════════════════════════
// t() del vertical barber CON alarma en desarrollo.
//
// POR QUÉ EXISTE: makeT (src/i18n/t.ts) devuelve la propia llave cuando no
// resuelve. Es un fallback correcto —nunca rompe el render— pero es MUDO:
// /barber/campanas llegó a producción pintando "barber.campanas.title" en
// el encabezado y nadie se enteró, porque la pantalla "funcionaba".
//
// La causa de aquel caso no fue una llave faltante sino un DESAJUSTE DE
// ALCANCE: la página bajaba el sub-árbol `barber.campanas` mientras el hook
// del cliente anteponía `barber.campanas.` a cada llave, así que buscaba
// `barber.campanas.title` DENTRO de `barber.campanas`. Con este envoltorio
// ese error se delata al primer render: sale un console.warn por cada llave
// cruda, con la ruta COMPLETA que se intentó resolver.
//
// SOLO EN DESARROLLO. En producción `makeBarberT` devuelve exactamente el
// mismo `makeT` (o un prefijo puro): cero comprobaciones, cero costo, cero
// ruido en la consola de la barbería.
//
// Este archivo es del vertical (src/lib/barber/**) y NO toca el motor
// compartido: el panel dental sigue usando makeT tal cual.
// ═══════════════════════════════════════════════════════════════════════
import { makeT, type Dictionary, type TFunction, type TVars } from "@/i18n/t";

const IS_DEV = process.env.NODE_ENV !== "production";

// Una llave se avisa UNA vez por proceso/pestaña: una tabla de 200 filas no
// debe escupir 200 líneas iguales y enterrar el resto de la consola.
const warned = new Set<string>();

/**
 * Filtra los falsos positivos: `t()` también recibe textos ya resueltos en
 * algunos sitios (nombres, montos ya formateados). Una llave de verdad es
 * un identificador con puntos y sin espacios.
 */
function looksLikeKey(key: string): boolean {
  return key.includes(".") && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(key);
}

/**
 * Construye el `t` del vertical.
 *
 *   makeBarberT(dictRaiz)                        → t("barber.agenda.title")
 *   makeBarberT(dictRaiz, "barber.campanas")     → t("title")
 *   makeBarberT(subArbolCaja)                    → t("ticket.title")
 *
 * `prefix` es el alcance que el componente da por puesto. El diccionario que
 * recibe DEBE ser la raíz desde la que ese prefijo es navegable: si el
 * servidor ya recortó el sub-árbol, el prefijo va vacío.
 */
export function makeBarberT(dict: Dictionary, prefix = ""): TFunction {
  const base = makeT(dict);
  const p = prefix && !prefix.endsWith(".") ? `${prefix}.` : prefix;

  if (!IS_DEV) {
    return p ? (key: string, vars?: TVars) => base(p + key, vars) : base;
  }

  return function t(key: string, vars?: TVars): string {
    if (typeof key !== "string") return "";
    const full = p + key;
    const out = base(full, vars);
    // makeT devuelve la llave tal cual cuando no resuelve a string.
    if (out === full && looksLikeKey(full) && !warned.has(full)) {
      warned.add(full);
      console.warn(
        `[barber i18n] llave SIN traducir: "${full}" — se está pintando la llave cruda. ` +
          (p
            ? `El componente antepone "${p}"; comprueba que el servidor esté bajando el diccionario COMPLETO (getBarberDict) y no el sub-árbol ya recortado.`
            : "Comprueba que exista en src/i18n/dictionaries/barber/ (es Y en)."),
      );
    }
    return out;
  };
}

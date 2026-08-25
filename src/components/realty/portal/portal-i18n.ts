import type { Dictionary, TFunction } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import portalEs from "@/i18n/dictionaries/realty/portal.json";

/* ═══════════════════════════════════════════════════════════════════════
   Diccionario del portal del cliente. PUNTO ÚNICO: servidor y navegador
   piden su `t` aquí y nadie arma el suyo.

   ── CONVENCIÓN B: SUB-ÁRBOL YA RECORTADO, PREFIJO VACÍO ───────────────
   El JSON se importa DIRECTO y makeRealtyT va SIN segundo argumento, así
   que las llaves se piden cortas:  t("login.title"), t("pagos.recibo").
   NUNCA con "realty.portal." delante. Cruzar las dos convenciones es el
   bug que pintó llaves crudas en barber (ver src/lib/realty/i18n.ts): el
   prefijo se aplicaría dos veces y la pantalla mostraría el identificador.

   ── POR QUÉ NO SE REGISTRA EN dictionaries/realty/index.ts ────────────
   Ese índice cuelga cada área bajo `realty.*` y su prueba de alcance exige
   que ES y EN tengan EXACTAMENTE las mismas llaves. El portal es de
   ESPAÑOL DE MÉXICO y de un solo idioma a propósito: lo abre un inquilino
   o un propietario mexicano desde una liga de WhatsApp, no una cuenta con
   el panel en inglés. Registrar un `portal.es.json` sin su gemelo en
   inglés reventaría esa prueba para las otras nueve terminales de la ola;
   inventar una traducción al inglés que nadie va a leer es peor.

   El día que haga falta inglés aquí: se parte en portal.es.json /
   portal.en.json y se registran las dos líneas en el índice. Este archivo
   es el único punto a tocar.
   ═══════════════════════════════════════════════════════════════════════ */

export const PORTAL_DICT = portalEs as unknown as Dictionary;

/** El `t` del portal. Sin prefijo — ver la nota de arriba. */
export function portalT(): TFunction {
  return makeRealtyT(PORTAL_DICT);
}

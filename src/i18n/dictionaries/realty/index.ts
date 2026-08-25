// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — árbol de diccionarios PROPIO del vertical.
//
// REGLA (Ola 0): NO se toca src/i18n/dictionaries/{es,en}.json — esos son
// del panel dental. Cada terminal de la Ola 1 crea SU par de archivos
// (<area>.es.json / <area>.en.json) en ESTA carpeta y agrega UNA línea por
// objeto (ES / EN) abajo. Así diez terminales en paralelo no chocan en un
// mismo JSON gigante.
//
// Todas las llaves viven bajo el namespace `realty.*`:
//   t("realty.shell.nav.inmuebles") → "Inmuebles"
//   t("realty.inmuebles.emptyTitle") → (lo crea la terminal de inmuebles)
//
// ⚠️ EL JSON NO LLEVA SU PROPIO NAMESPACE. shell.es.json empieza en
// `{ "brand": …, "nav": … }` y es ESTE archivo el que lo cuelga de
// `realty.shell`. Por eso hay DOS convenciones y CRUZARLAS es el bug:
//   · Servidor con el diccionario COMPLETO → t("realty.shell.nav.inicio")
//   · Servidor con el sub-árbol ya recortado → t("nav.inicio"), prefijo VACÍO
// Si el servidor recorta Y el componente antepone el prefijo, el prefijo se
// aplica DOS VECES y la pantalla pinta la llave cruda. makeRealtyT
// (src/lib/realty/i18n.ts) lo grita en consola en desarrollo.
//
// El motor es el mismo makeT de src/i18n/t (puro, sirve en server y client).
// ═══════════════════════════════════════════════════════════════════════
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import shellEs from "./shell.es.json";
import shellEn from "./shell.en.json";
import registroEs from "./registro.es.json";
import registroEn from "./registro.en.json";
// ── Ola 1: importa aquí tu área (una línea por idioma) ──
import leadsEs from "./leads.es.json";
import leadsEn from "./leads.en.json";
import rentalsEs from "./rentals.es.json";
import rentalsEn from "./rentals.en.json";
import propertiesEs from "./properties.es.json";
import propertiesEn from "./properties.en.json";

const ES: Dictionary = {
  realty: {
    shell: shellEs as unknown as Dictionary,
    registro: registroEs as unknown as Dictionary,
    leads: leadsEs as unknown as Dictionary,
    rentals: rentalsEs as unknown as Dictionary,
    // T1 — cartera de inmuebles y propietarios.
    inmuebles: propertiesEs as unknown as Dictionary,
  },
};

const EN: Dictionary = {
  realty: {
    shell: shellEn as unknown as Dictionary,
    registro: registroEn as unknown as Dictionary,
    leads: leadsEn as unknown as Dictionary,
    rentals: rentalsEn as unknown as Dictionary,
    inmuebles: propertiesEn as unknown as Dictionary,
  },
};

export const REALTY_SUPPORTED_LOCALES = ["es", "en"] as const;
export type RealtyLocale = (typeof REALTY_SUPPORTED_LOCALES)[number];
export const REALTY_DEFAULT_LOCALE: RealtyLocale = "es";

export function resolveRealtyLocale(value: unknown): RealtyLocale {
  return value === "en" ? "en" : "es";
}

/** Diccionario completo del vertical para el locale dado (default es). */
export function getRealtyDict(locale?: string | null): Dictionary {
  return resolveRealtyLocale(locale) === "en" ? EN : ES;
}

/**
 * t() del vertical: getRealtyT(account.locale)("realty.shell.nav.inmuebles").
 *
 * Va por makeRealtyT y no por makeT a secas para que, EN DESARROLLO, una
 * llave que no resuelve grite en consola en vez de pintarse cruda en la
 * pantalla (ver src/lib/realty/i18n.ts). En producción es makeT tal cual.
 */
export function getRealtyT(locale?: string | null) {
  return makeRealtyT(getRealtyDict(locale));
}

/**
 * Los dos diccionarios crudos. Los usa la prueba de alcance
 * (src/lib/realty/__tests__/i18n-alcance.test.ts) para recorrer las
 * pantallas y fallar si alguna llave se quedó sin traducir en ES o en EN.
 */
export const REALTY_DICTS: Record<RealtyLocale, Dictionary> = { es: ES, en: EN };

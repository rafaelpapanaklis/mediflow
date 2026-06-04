// src/i18n/dictionaries.ts
import esDict from "./dictionaries/es.json";
import enDict from "./dictionaries/en.json";
import type { Dictionary } from "./t";

// Locales soportados por el panel. "es" es la fuente (texto original exacto);
// "en" la traducción. Mismas llaves en ambos diccionarios.
export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

const DICTIONARIES: Record<Locale, Dictionary> = {
  es: esDict as Dictionary,
  en: enDict as Dictionary,
};

export function isLocale(value: unknown): value is Locale {
  return value === "es" || value === "en";
}

// Normaliza cualquier valor (p.ej. clinic.locale, que puede ser null) a un
// locale válido, cayendo a DEFAULT_LOCALE.
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// Devuelve el diccionario del locale dado. Acepta null/undefined → DEFAULT_LOCALE.
export function getDict(locale?: string | null): Dictionary {
  return DICTIONARIES[resolveLocale(locale)];
}

// La frase de cada código de las filas del plan (ws1-t12), en el idioma que se pida. La API la
// contesta en `error` (la pantalla la enseña tal cual) con el código en `code` y, si aplica, la fila
// en `indice` (desde 0). Puro.

import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { CLAVE_DE_CODIGO, type CodigoDeFila } from "./items";

export function mensajeDeFila(codigo: string, locale: "es" | "en" = "es"): string {
  const t = makeT(getDict(locale));
  const clave = (CLAVE_DE_CODIGO as Record<string, string>)[codigo];
  return clave ? t(clave) : t("planTratamiento.filas.error.generico");
}

/** Cuerpo JSON del error: `{ error, code, indice? }`. */
export function cuerpoDeErrorDeFila(codigo: CodigoDeFila | string, indice?: number | null) {
  return { error: mensajeDeFila(codigo), code: codigo, ...(typeof indice === "number" && indice >= 0 ? { indice } : {}) };
}

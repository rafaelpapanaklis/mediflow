// ws1-t2 (ticket BEVADENT 3, punto 12h) — textos del aviso «Salud sin capturar».
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que textos-consulta-ficha.ts): los
// diccionarios los tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  /** Chip ámbar: el paciente no tiene cuestionario de salud. */
  sinCapturar: "Salud sin capturar",
  /** Chip ámbar: el cuestionario existe pero ya venció. */
  vencida: "Cuestionario de salud vencido",
  /** Ayuda del chip cuando se puede abrir el cuestionario. */
  abrirCuestionario: "Abrir el cuestionario de salud",
  /** Ayuda del chip cuando la sesión no puede abrir el expediente clínico. */
  sinPermiso: "Falta capturar su cuestionario de salud; lo llena quien tenga acceso al expediente.",
};

const en: typeof es = {
  sinCapturar: "Health not recorded",
  vencida: "Health questionnaire expired",
  abrirCuestionario: "Open the health questionnaire",
  sinPermiso: "The health questionnaire is still missing; someone with access to the record fills it in.",
};

export type TextosSaludCapturada = typeof es;

export function textosSaludCapturada(locale: string | null | undefined): TextosSaludCapturada {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosSaludCapturada(): TextosSaludCapturada {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosSaludCapturada(locale);
}

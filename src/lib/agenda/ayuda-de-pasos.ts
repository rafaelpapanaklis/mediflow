// ws1-t2 (ticket BEVADENT 3, punto 9a) — una línea de ayuda bajo «Marcar llegada», «Pasar al sillón» y
// «Pasar a consulta». Los tres botones son pasos distintos del recorrido de la cita y, sin explicación,
// parecían lo mismo. La usan la Agenda nueva, la de siempre y Hoy; los textos viven en un solo sitio.
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que textos-consulta-ficha.ts): los
// diccionarios los tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

/** Los únicos estados destino que llevan ayuda: los tres pasos que se confunden. */
export type PasoConAyuda = "CHECKED_IN" | "IN_CHAIR" | "IN_PROGRESS";

const es: Record<PasoConAyuda, string> = {
  CHECKED_IN: "El paciente llegó y espera",
  IN_CHAIR: "Ya está en el sillón",
  IN_PROGRESS: "Empezar la atención y abrir su expediente",
};

const en: Record<PasoConAyuda, string> = {
  CHECKED_IN: "The patient has arrived and is waiting",
  IN_CHAIR: "Already in the chair",
  IN_PROGRESS: "Start the visit and open the patient's record",
};

/** La ayuda del paso al que lleva el botón, o null si ese paso no lleva (Confirmar, Cobrar, Cancelar…). */
export function ayudaDelPaso(destino: string | null | undefined, locale: string | null | undefined): string | null {
  if (destino !== "CHECKED_IN" && destino !== "IN_CHAIR" && destino !== "IN_PROGRESS") return null;
  return (locale === "en" ? en : es)[destino];
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useAyudaDelPaso(): (destino: string | null | undefined) => string | null {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return (destino) => ayudaDelPaso(destino, locale);
}

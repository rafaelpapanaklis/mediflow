// ws1-t11 (11c, tercer ticket de BEVADENT) — textos del interruptor «Pedir
// reseña al terminar la cita» (Configuración → Integraciones → Automatizaciones).
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que
// textos-salud-capturada.ts): los diccionarios los tocan a la vez otras
// pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  resenaTitulo: "Pedir reseña al terminar la cita",
  resenaDescripcion:
    "Al terminar una cita, le manda al paciente el enlace para calificar su visita (WhatsApp y correo). Si también tienes encendido el seguimiento post-cita, recibe dos mensajes por la misma visita.",
  resenaError: "No se pudo guardar. Inténtalo de nuevo.",
};

const en: typeof es = {
  resenaTitulo: "Ask for a review when the appointment ends",
  resenaDescripcion:
    "When an appointment ends, sends the patient a link to rate their visit (WhatsApp and email). If the post-visit follow-up is also on, they get two messages for the same visit.",
  resenaError: "Couldn't save. Please try again.",
};

export type TextosResena = typeof es;

export function textosResena(locale: string | null | undefined): TextosResena {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosResena(): TextosResena {
  let locale = "es";
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- se llama siempre, una vez; el try solo cubre la falta de provider
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosResena(locale);
}

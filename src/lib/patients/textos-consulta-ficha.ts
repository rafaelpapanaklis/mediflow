// ws1-t8 (revisión de ws1-t9, fallos 1 y 6) — textos nuevos de la consulta en la ficha.
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que textos-firma-control.ts): los
// diccionarios los tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  /** «Iniciar consulta» no pudo pasar la cita de hoy a «En consulta» y el servidor no dijo por qué. */
  noSeInicioLaConsulta: "No se pudo pasar la cita a «En consulta». Inténtalo desde la Agenda.",
  /** Nueva consulta: lo escrito en «Dental general» viaja a la hoja de control al cambiar a Ortodoncia. */
  loEscritoPasaALaHoja: "Lo que escribiste en «Dental general» pasó a la hoja de control.",
  /** «Iniciar consulta» apagado: la próxima cita del paciente es de otro profesional (fallo nuevo 1). */
  citaDeOtroProfesional: "La próxima cita es con otro profesional: solo quien la atiende puede iniciarla.",
  /** «Iniciar consulta» apagado: la sesión no puede pasar citas a «En consulta» (rol o permiso). */
  sinPermisoParaIniciar: "Tu usuario no puede iniciar consultas: la inicia el doctor que atiende la cita.",
};

const en: typeof es = {
  noSeInicioLaConsulta: "The appointment could not be set to “In consultation”. Try from the Schedule.",
  loEscritoPasaALaHoja: "What you wrote in “General dentistry” was moved to the check-up sheet.",
  citaDeOtroProfesional: "The next appointment is with another provider: only they can start it.",
  sinPermisoParaIniciar: "Your user can't start consultations: the attending doctor starts it.",
};

export type TextosConsultaFicha = typeof es;

export function textosConsultaFicha(locale: string | null | undefined): TextosConsultaFicha {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosConsultaFicha(): TextosConsultaFicha {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosConsultaFicha(locale);
}

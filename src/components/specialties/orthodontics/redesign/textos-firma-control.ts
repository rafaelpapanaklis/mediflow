// Ortodoncia — textos de la firma de la hoja de control que estrenó ws1-t8 (ticket BEVADENT, puntos 3, 10 y 12).
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que textos-equipo.ts): los diccionarios los
// tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

/** «2026-10-06» (día de calendario de la clínica) → «6 oct» / «Oct 6». */
function fechaCorta(dia: string, locale: "es" | "en"): string {
  const d = new Date(`${dia}T12:00:00Z`);
  return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
}

const CAMPOS = {
  es: { s: "Subjetivo", o: "Objetivo", a: "Análisis" },
  en: { s: "Subjective", o: "Objective", a: "Assessment" },
} as const;

function lista(partes: string[], y: string): string {
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} ${y} ${partes[partes.length - 1]}` : (partes[0] ?? "");
}

const es = {
  huecosOpcionales: (total: number, campos: Array<"s" | "o" | "a">) =>
    `${total === 1 ? "1 dato opcional sin llenar" : `${total} datos opcionales sin llenar`} (____) en ${lista(
      campos.map((c) => CAMPOS.es[c]),
      "y",
    )}. Puedes firmar así: quedará escrito «[sin dato]».`,
  citaDeOtroDia: (dia: string) =>
    `Esta cita es del ${fechaCorta(dia, "es")} y el paciente no ha llegado. Si firmas hoy, la hoja queda como visita de hoy y la cita del ${fechaCorta(dia, "es")} no se marca como atendida.`,
  firmadaSinTocarCita: (dia: string) =>
    `Control firmado como visita de hoy. La cita del ${fechaCorta(dia, "es")} no se tocó: si ya no hace falta, muévela o cancélala en la Agenda.`,
  consultaTerminada: "Control firmado y consulta terminada",
  // Revisión de ws1-t9, fallo 2: la hoja de hoy se firmó «sin cita» y después apareció la cita de hoy.
  hojaFirmadaLigadaYCitaCerrada: "El control de hoy ya estaba firmado: quedó como el control de esta cita y la cita se marcó como atendida.",
  hojaFirmadaLigadaSinCerrar: "El control de hoy ya estaba firmado y quedó ligado a esta cita. La consulta tiene su propia nota: termínala para cerrar la cita.",
  /** Botón de la fila (Hoy, panel de la cita, Tablero, Controles) cuando el control de esa cita ya está firmado. */
  verControl: "Ver control",
};

const en: typeof es = {
  huecosOpcionales: (total, campos) =>
    `${total === 1 ? "1 optional field left blank" : `${total} optional fields left blank`} (____) in ${lista(
      campos.map((c) => CAMPOS.en[c]),
      "and",
    )}. You can sign as is: it will read “[sin dato]” (no data).`,
  citaDeOtroDia: (dia) =>
    `This appointment is on ${fechaCorta(dia, "en")} and the patient hasn't arrived. If you sign today, the sheet is saved as today's visit and the ${fechaCorta(dia, "en")} appointment is not marked as attended.`,
  firmadaSinTocarCita: (dia) =>
    `Check-up signed as today's visit. The ${fechaCorta(dia, "en")} appointment was left as is: if it's no longer needed, move or cancel it in the Schedule.`,
  consultaTerminada: "Check-up signed and visit closed",
  hojaFirmadaLigadaYCitaCerrada: "Today's check-up was already signed: it is now this appointment's check-up and the appointment was marked as attended.",
  hojaFirmadaLigadaSinCerrar: "Today's check-up was already signed and is now linked to this appointment. The visit has its own note: finish it to close the appointment.",
  verControl: "View check-up",
};

export type TextosFirmaControl = typeof es;

export function textosFirmaControl(locale: string | null | undefined): TextosFirmaControl {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español: el cajón también se monta en portales. */
export function useTextosFirmaControl(): TextosFirmaControl {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosFirmaControl(locale);
}

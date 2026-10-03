// Ortodoncia — el aviso «Falta el consentimiento» dice QUÉ carta busca (ws1-t3, auditoría BEVADENT F1).
//
// Vive aquí y no en los diccionarios por el mismo motivo que textos-firma-control.ts: los diccionarios
// los tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";
import { NOMBRE_CARTA_ORTODONCIA } from "@/lib/consent/consentimiento-ortodoncia";

const es = {
  titulo: "Falta el consentimiento de ortodoncia firmado.",
  cuerpo: `Se busca en «Consentimientos» la carta «${NOMBRE_CARTA_ORTODONCIA}» —o cualquier carta cuyo título diga «ortodoncia»— firmada por el paciente o su representante y sin revocar.`,
  ir: "Ir a Consentimientos",
};

export type TextosConsentimientoOrto = typeof es;

const en: TextosConsentimientoOrto = {
  titulo: "The signed orthodontic consent is missing.",
  cuerpo: `We look in «Consents» for the «${NOMBRE_CARTA_ORTODONCIA}» letter —or any letter whose title says «ortodoncia»— signed by the patient or their representative and not revoked.`,
  ir: "Go to Consents",
};

export function textosConsentimientoOrto(locale: string | null | undefined): TextosConsentimientoOrto {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosConsentimientoOrto(): TextosConsentimientoOrto {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosConsentimientoOrto(locale);
}

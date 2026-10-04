// Consentimientos — los avisos de «la carta tiene espacios sin llenar» (ws1-t3, auditoría BEVADENT F2).
//
// Viven aquí y no en los diccionarios: es.json/en.json los tocan a la vez otras pantallas de la tanda
// y un commit de esos archivos arrastraría sus líneas (mismo motivo que textos-firma-control.ts).

import { useLocale } from "@/i18n/i18n-provider";
import { avisoDeCarta, type RevisionDeCarta } from "@/lib/consent/huecos-carta";

type Locale = "es" | "en";

function textos(locale: Locale) {
  const aviso = (r: RevisionDeCarta) => avisoDeCarta(r, locale);
  if (locale === "en") {
    return {
      aviso,
      titulo: "This letter is not complete",
      /** Tira de firmas de la carta guardada, en lugar de «The letter is complete». */
      tiraFirmada: (r: RevisionDeCarta) =>
        `Both signatures are in, but it was signed like this. ${aviso(r)} You can still download, print or send it.`,
      tiraPendiente: (r: RevisionDeCarta) => `${aviso(r)} Whoever signs will be asked to confirm.`,
      editor: (r: RevisionDeCarta) => `${aviso(r)} Fill them in before creating the letter, or confirm when you create it.`,
      crear: (r: RevisionDeCarta) => `${aviso(r)} The patient will sign the letter exactly as it is. Create it anyway?`,
      crearSi: "Create anyway",
      mandar: (r: RevisionDeCarta) => `${aviso(r)} The patient will sign the letter exactly as it is. Send it for signature anyway?`,
      mandarSi: "Send anyway",
      contrafirmar: (r: RevisionDeCarta) => `${aviso(r)} Your signature will go on the letter exactly as it is. Sign anyway?`,
      contrafirmarSi: "Sign anyway",
      revisar: "Review the letter",
      // C-79 (auditoría de uso): la firma del doctor tarda; el botón dice qué está pasando.
      guardandoFirma: "Saving your signature…",
    };
  }
  return {
    aviso,
    titulo: "La carta no está completa",
    tiraFirmada: (r: RevisionDeCarta) =>
      `Están las dos firmas, pero se firmó así. ${aviso(r)} Puedes descargarla, imprimirla o mandarla igual.`,
    tiraPendiente: (r: RevisionDeCarta) => `${aviso(r)} A quien firme se le pedirá confirmarlo.`,
    editor: (r: RevisionDeCarta) => `${aviso(r)} Llénalos antes de crear la carta, o confírmalo al crearla.`,
    crear: (r: RevisionDeCarta) => `${aviso(r)} El paciente firmará la carta tal como está. ¿Crearla así?`,
    crearSi: "Crear así",
    mandar: (r: RevisionDeCarta) => `${aviso(r)} El paciente firmará la carta tal como está. ¿Mandarla a firmar así?`,
    mandarSi: "Mandar así",
    contrafirmar: (r: RevisionDeCarta) => `${aviso(r)} Tu firma quedará sobre la carta tal como está. ¿Firmar así?`,
    contrafirmarSi: "Firmar así",
    revisar: "Revisar la carta",
    // C-79 (auditoría de uso): la firma del doctor tarda; el botón dice qué está pasando.
    guardandoFirma: "Guardando tu firma…",
  };
}

export type TextosHuecosCarta = ReturnType<typeof textos>;

export function textosHuecosCarta(locale: string | null | undefined): TextosHuecosCarta {
  return textos(locale === "en" ? "en" : "es");
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosHuecosCarta(): TextosHuecosCarta {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosHuecosCarta(locale);
}

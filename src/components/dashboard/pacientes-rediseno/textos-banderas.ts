// Cuestionario — la tarjeta «Banderas de riesgo» ya no dice «Ninguna» a secas (ws1-t3, auditoría BEVADENT F6).
//
// Viven aquí y no en los diccionarios: es.json/en.json los tocan a la vez otras pantallas de la tanda y
// un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";
import type { ResumenDeBanderas } from "@/lib/patients/resumen-banderas";

const es = {
  /** «Sin banderas de riesgo · Padecimientos: Asma · Alergias: AINEs / aspirina». */
  sinBanderasCon: (r: ResumenDeBanderas) =>
    ["Sin banderas de riesgo", ...marcado(r, "Padecimientos", "Alergias")].join(" · "),
  /** Con banderas, lo demás marcado que no levanta ninguna. */
  tambienMarcado: (r: ResumenDeBanderas) => `También marcado, sin bandera: ${marcado(r, "Padecimientos", "Alergias").join(" · ")}`,
  queLevanta: "¿Qué respuestas levantan una bandera?",
  queLevantaPie: "Solo estas respuestas levantan bandera. Lo demás que se marque sale en la tarjeta y en el expediente, sin bandera.",
};

export type TextosBanderas = typeof es;

const en: TextosBanderas = {
  sinBanderasCon: (r) => ["No risk flags", ...marcado(r, "Conditions", "Allergies")].join(" · "),
  tambienMarcado: (r) => `Also marked, no flag: ${marcado(r, "Conditions", "Allergies").join(" · ")}`,
  queLevanta: "Which answers raise a flag?",
  queLevantaPie: "Only these answers raise a flag. Anything else that is marked shows on this card and in the record, without a flag.",
};

function marcado(r: ResumenDeBanderas, padecimientos: string, alergias: string): string[] {
  const out: string[] = [];
  if (r.padecimientos.length) out.push(`${padecimientos}: ${r.padecimientos.join(", ")}`);
  if (r.alergias.length) out.push(`${alergias}: ${r.alergias.join(", ")}`);
  return out;
}

export function textosBanderas(locale: string | null | undefined): TextosBanderas {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosBanderas(): TextosBanderas {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosBanderas(locale);
}

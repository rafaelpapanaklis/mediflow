// «Completar consulta» con la nota ya firmada (auditoría de uso, C-65).
//
// Tras «Guardar consulta» (que guarda Y firma la nota de la cita) la ficha enseñaba debajo de la barra de la
// consulta el editor SOAP VACÍO con «Firmar y completar consulta»: parecía que había que capturar todo otra vez.
// Con la nota firmada se dice eso y se ofrece solo cerrar la cita. Los textos viven aquí y no en los
// diccionarios: los tocan a la vez otras pantallas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  titulo: "La nota de esta consulta ya quedó guardada y firmada.",
  texto: "No hace falta capturarla otra vez: «Completar consulta» solo cierra la cita.",
  completar: "Completar consulta",
  completando: "Completando…",
};
const en: typeof es = {
  titulo: "This visit's note is already saved and signed.",
  texto: "No need to write it again: «Complete visit» just closes the appointment.",
  completar: "Complete visit",
  completando: "Completing…",
};

export function useTextosConsultaFirmada(): typeof es {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return locale === "en" ? en : es;
}

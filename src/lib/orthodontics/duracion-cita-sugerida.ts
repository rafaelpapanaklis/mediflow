// Duración sugerida de una cita de ortodoncia en la ventana «Nueva cita»
// (sección I de la revisión de lógica de uso). PURO y seguro en el cliente.
//
// Mismo orden de preferencia que el bot de WhatsApp (`whatsapp-bot-booking.ts`):
// (1) los minutos que la clínica fijó para ESE tipo de cita en Configuración
// de Ortodoncia, (2) el mejor esfuerzo de `suggestOrthoAppointmentDuration()`
// sobre el texto del motivo. Sin ninguno de los dos: `null` (no se propone
// nada y la duración se queda como está).

import { suggestOrthoAppointmentDuration } from "./appointment-durations";

export interface TipoDeCitaConDuracion {
  label: string;
  durationMin?: number | null;
}

export interface DuracionSugerida {
  minutos: number;
  /** Qué se le dice al usuario: «Duración sugerida para <tipo>». */
  tipo: string;
  origen: "configuracion" | "texto";
}

function comparable(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

export function duracionSugeridaDeOrtodoncia(
  motivo: string,
  tipos: ReadonlyArray<TipoDeCitaConDuracion>,
): DuracionSugerida | null {
  const texto = motivo.trim();
  if (!texto) return null;
  const tipo = tipos.find((t) => comparable(t.label) === comparable(texto));
  if (tipo && typeof tipo.durationMin === "number" && tipo.durationMin > 0) {
    return { minutos: tipo.durationMin, tipo: tipo.label, origen: "configuracion" };
  }
  const porTexto = suggestOrthoAppointmentDuration(texto);
  if (porTexto) return { minutos: porTexto.minutes, tipo: tipo?.label ?? porTexto.label, origen: "texto" };
  return null;
}

/**
 * La encuesta posterior a la cita («¿Cómo te sentiste con tu atención?»): a
 * qué citas SÍ se les pregunta. LÓGICA PURA, sin Prisma, para probarla en node.
 *
 * ws1-t5, 28-sep-2026 (revisión de lógica de uso, fila 7 del mapa): un
 * paciente de ortodoncia viene a control cada mes durante año y medio, y la
 * encuesta le salía después de CADA control. Lo mismo con los controles de
 * retención. Esas dos visitas son de rutina y se quedan fuera; la valoración,
 * la colocación, el retiro y cualquier otra cita se siguen preguntando.
 */
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

/** El texto del catálogo de tipos de cita de ortodoncia (clinic-settings-db.ts). */
export const TIPO_CITA_CONTROL_RETENCION = "Control de retención";

/** Sin espacios de más, sin mayúsculas y sin acentos. */
function comparable(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const VISITAS_DE_RUTINA = [TIPO_CITA_CONTROL_ORTO, TIPO_CITA_CONTROL_RETENCION].map(comparable);

/** ¿La cita es una visita de rutina de ortodoncia (control mensual o de retención)? */
export function esVisitaDeRutinaDeOrtodoncia(tipo: string | null | undefined): boolean {
  if (typeof tipo !== "string") return false;
  return VISITAS_DE_RUTINA.includes(comparable(tipo));
}

export type MotivoSinEncuesta = "sin-telefono" | "ya-preguntada" | "visita-de-rutina-ortodoncia";

/**
 * Por qué NO se le pregunta a esta cita, o `null` si sí toca preguntar.
 * El orden importa solo para el conteo: primero lo que ya era así.
 */
export function motivoSinEncuesta(cita: {
  tipo: string | null | undefined;
  telefono: string | null | undefined;
  yaPreguntada: boolean;
}): MotivoSinEncuesta | null {
  if (!cita.telefono) return "sin-telefono";
  if (cita.yaPreguntada) return "ya-preguntada";
  if (esVisitaDeRutinaDeOrtodoncia(cita.tipo)) return "visita-de-rutina-ortodoncia";
  return null;
}

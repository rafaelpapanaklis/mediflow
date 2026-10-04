// ═══════════════════════════════════════════════════════════════════════════
// SALA DE ESPERA — qué cuenta como «esperando ahora» y cómo se dice cuánto
// (ws1-t2, auditoría de uso C-27). Puro, sin Prisma
// (src/lib/analytics/__tests__/sala-de-espera.test.ts).
//
// La auditoría vio «5 pacientes esperando >20 min» con «1956m», «1950m»,
// «1735m»: citas de días ANTERIORES que se quedaron en «Llegó» (nadie marcó
// «En sillón»). La consulta no tenía límite de fecha. Ahora solo cuenta quien
// llegó HOY (día de la clínica) y sigue sin pasar al sillón ni a consulta, y
// cuya cita no se cerró. Y una espera larga se dice en horas, no en minutos.
// ═══════════════════════════════════════════════════════════════════════════

import type { Prisma } from "@prisma/client";

/** Estados de cita que ya no esperan: se cerró, se canceló o no vino. */
export const ESTADOS_QUE_NO_ESPERAN = ["COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"] as const;

/**
 * `where` de AppointmentTimeline de quien espera AHORA más del umbral: llegó
 * hoy (desde `inicioDeHoy`, medianoche de la clínica) y hace más de
 * `umbralMin`, no ha pasado al sillón ni a consulta y su cita sigue abierta.
 * `extraCita` es el filtro de visibilidad por paciente de quien pregunta.
 */
export function esperandoAhoraWhere(
  clinicId: string,
  ahora: Date,
  inicioDeHoy: Date,
  umbralMin: number,
  extraCita: Prisma.AppointmentWhereInput = {},
): Prisma.AppointmentTimelineWhereInput {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  const umbralAtras = new Date(ahora.getTime() - umbralMin * 60_000);
  return {
    appointment: { clinicId, status: { notIn: [...ESTADOS_QUE_NO_ESPERAN] }, ...extraCita },
    arrivedAt: { gte: inicioDeHoy, lte: umbralAtras },
    inChairAt: null,
    consultStartAt: null,
  };
}

/** «45 min», «2 h 5 min», «32 h». Nunca «1956m». */
export function duracionLegible(min: number, idioma: "es" | "en" = "es"): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  if (h >= 24 || resto === 0) return `${h} h`;
  return idioma === "en" ? `${h} h ${resto} min` : `${h} h ${resto} min`;
}

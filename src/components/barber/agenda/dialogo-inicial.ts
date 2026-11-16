// ═══════════════════════════════════════════════════════════════════════
// Con qué arranca el diálogo de visita (Nueva / Editar / Repetir / Agendar
// a un cliente). Funciones puras, sin React ni CSS, para probarlas solas.
//
// Fallo que corrigen (t4, pase 15): «Agendar cita» desde la ficha y
// «Agendar» desde Mensajes (?nueva=) armaban un prefill de «Repetir» con
// startAt = endAt = ahora. El diálogo lo tomaba como visita a repetir que
// «duró 0 min» y distinta de su catálogo (sin servicios = un hueco
// mínimo), así que fijaba la duración a mano en 0 y el servidor
// respondía 400 BAD_DURATION. Ahora:
//   · ?nueva= NO es un «repetir»: solo trae al cliente (NewClientSeed);
//   · y aunque llegue una fuente sin duración real (0 o negativa), la
//     duración sigue a los servicios elegidos (null = «la del catálogo»).
// ═══════════════════════════════════════════════════════════════════════
import { appointmentMinutes, totalServiceMinutes } from "@/lib/barber/agenda";

/** El cliente con el que arranca «Nueva visita» desde la ficha o Mensajes. */
export interface NewClientSeed {
  clientId: string;
  clientName: string;
  clientPhone: string | null;
}

interface SourceLike {
  startAt: string;
  endAt: string;
  services: { serviceId: string }[];
}

/**
 * Duración a mano con la que arranca el diálogo. `null` = sigue al catálogo
 * (la suma de los servicios elegidos, mínimo un hueco); el servidor la
 * calcula igual cuando no le llega `durationMin`.
 *
 *   · Nueva visita (sin fuente) → null.
 *   · Editar / Repetir → la duración guardada SOLO si es real (> 0) y no
 *     coincide con lo que suma su catálogo; si coincide, null (tocar un
 *     servicio sigue ajustando la duración sola).
 */
export function initialCustomMinutes(
  source: SourceLike | null,
  services: { id: string; durationMin: number }[],
): number | null {
  if (!source) return null;
  const saved = appointmentMinutes(source);
  if (!(saved > 0)) return null;
  const fromCatalog = totalServiceMinutes(services.filter((s) => source.services.some((x) => x.serviceId === s.id)));
  return saved === fromCatalog ? null : saved;
}

/** Lo que se manda como `durationMin`: solo la duración a mano; null = la del catálogo. */
export function durationToSend(customMinutes: number | null): number | null {
  return customMinutes !== null && customMinutes > 0 ? customMinutes : null;
}

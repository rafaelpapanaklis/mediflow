// El aviso «Conflicto» de Editar cita, atado al hueco que lo provocó (menores de la revisión final, ws1-t10,
// 2-oct-2026). PURO.
//
// Antes el aviso solo se ponía y se quitaba al pulsar Guardar: si el servidor contestaba «se solapa» con
// Mariana a las 12:00 y la persona cambiaba a un doctor libre, el aviso y el botón «Sobrescribir y guardar»
// seguían ahí, y el motivo para forzar se mandaba igual (ese motivo APAGA el no-solape en el servidor). Ahora
// el aviso del servidor vale solo para el hueco que se intentó (día, hora, duración, doctor y sillón); en
// cuanto el hueco cambia se recalcula con las citas que la agenda ya tiene cargadas, y si ahí no choca nada
// el aviso se va. El servidor sigue siendo quien decide al guardar: si el hueco nuevo choca con algo que la
// pantalla no tenía cargado, el aviso vuelve con su respuesta, como siempre.

import { describeOverlapConflict } from "./conflict-copy";
import { findOverlap } from "./overlap-client";
import type { AgendaAppointmentDTO } from "./types";

export interface HuecoEditado {
  date: string;
  startTime: string;
  durationMin: number;
  doctorId: string;
  /** "" = sin sillón. */
  resourceId: string;
}

/** El aviso tal como lo dejó la última respuesta del servidor, con el hueco para el que vale. */
export interface ConflictoDelServidor {
  texto: string;
  clave: string;
}

export function claveDelHueco(h: HuecoEditado): string {
  return [h.date, h.startTime, h.durationMin, h.doctorId, h.resourceId].join("|");
}

/**
 * El aviso que toca enseñar para el hueco que hay AHORA en el formulario.
 *
 *  - El del servidor, si es de este mismo hueco.
 *  - Si el hueco ya cambió: el choque con las citas cargadas (`citas`), con la misma frase que daría el
 *    servidor; si no choca con ninguna, nada.
 *  - Sin aviso previo del servidor no se adelanta nada: la ventana se comporta como siempre hasta el primer
 *    «se solapa» (no se pide «Sobrescribir» por algo que el servidor quizá acepta).
 */
export function conflictoVigente(args: {
  delServidor: ConflictoDelServidor | null;
  hueco: HuecoEditado;
  /** Inicio y fin ISO del hueco; `null` si la fecha u hora no se pueden leer. */
  rango: { startsAt: string; endsAt: string } | null;
  citaId: string;
  citas: readonly AgendaAppointmentDTO[];
}): string | null {
  const { delServidor, hueco, rango, citaId, citas } = args;
  if (!delServidor) return null;
  if (delServidor.clave === claveDelHueco(hueco)) return delServidor.texto;
  if (!rango || !hueco.doctorId) return null;
  const choque = findOverlap(
    {
      excludeId: citaId,
      doctorId: hueco.doctorId,
      resourceId: hueco.resourceId || null,
      startsAt: rango.startsAt,
      endsAt: rango.endsAt,
    },
    [...citas],
  );
  if (!choque) return null;
  const c = choque.conflictWith;
  return describeOverlapConflict(
    { id: c.id, patientName: c.patient?.name ?? null, doctorId: c.doctor?.id ?? "", resourceId: c.resourceId },
    { doctorId: hueco.doctorId, resourceId: hueco.resourceId || null },
  );
}

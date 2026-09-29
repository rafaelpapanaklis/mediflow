// Ortodoncia — «Posponer 7 días» en Alertas (fila 22 de la revisión de uso,
// ws1-t4 ronda 6). Lógica pura, sin base: qué se puede posponer, hasta
// cuándo, y quitar de las listas lo que sigue pospuesto. La tabla y su SQL:
// `alertas-pospuestas-db.ts` y `sql/ortodoncia-alertas-pospuestas.sql`.
//
// «Mensualidad vencida» y «Fotos por revisar» NO se posponen: la primera es
// dinero de un caso concreto (ya tiene su «Enviar recordatorio») y la segunda
// se atiende revisando las fotos.

export const TIPOS_POSPONIBLES = [
  "sin-proximo-control",
  "no-asistio",
  "proximo-a-terminar",
  "pasado-de-fecha",
  // ws1-t12: la reevaluación radiográfica del plan de tratamiento (fecha o periodicidad).
  "reevaluacion-radiografica",
] as const;

export type TipoPosponible = (typeof TIPOS_POSPONIBLES)[number];

export const DIAS_DE_POSPOSICION = 7;

export function esTipoPosponible(v: unknown): v is TipoPosponible {
  return typeof v === "string" && (TIPOS_POSPONIBLES as readonly string[]).includes(v);
}

export function hastaDePosposicion(ahora: Date): Date {
  return new Date(ahora.getTime() + DIAS_DE_POSPOSICION * 24 * 60 * 60 * 1000);
}

export interface Posposicion {
  patientId: string;
  tipo: TipoPosponible;
  hasta: Date;
}

function clave(patientId: string, tipo: TipoPosponible): string {
  return `${tipo}\u0000${patientId}`;
}

/** Las posposiciones que siguen vigentes en `ahora`, como conjunto consultable. */
export function vigentes(pospuestas: Posposicion[], ahora: Date): Set<string> {
  const set = new Set<string>();
  for (const p of pospuestas) {
    if (p.hasta.getTime() > ahora.getTime()) set.add(clave(p.patientId, p.tipo));
  }
  return set;
}

/**
 * Quita de `filas` las del paciente con una posposición vigente de `tipo`.
 * Devuelve las que quedan y cuántas se quitaron.
 */
export function quitarPospuestas<T extends { patientId: string }>(
  filas: T[],
  tipo: TipoPosponible,
  activas: Set<string>,
): { quedan: T[]; pospuestas: number } {
  const quedan = filas.filter((f) => !activas.has(clave(f.patientId, tipo)));
  return { quedan, pospuestas: filas.length - quedan.length };
}

export const ETIQUETA_DE_TIPO: Record<TipoPosponible, string> = {
  "sin-proximo-control": "Sin próximo control",
  "no-asistio": "No asistió",
  "proximo-a-terminar": "Próximo a terminar",
  "pasado-de-fecha": "Pasado de su fecha",
  "reevaluacion-radiografica": "Reevaluación radiográfica",
};

export interface PospuestaVisible {
  patientId: string;
  patientName: string;
  tipo: TipoPosponible;
  etiqueta: string;
  /** ISO: hasta cuándo sigue pospuesta. */
  hasta: string;
}

/**
 * H14: las alertas pospuestas que siguen vigentes, para poder VERLAS y
 * deshacerlas (antes solo salía «1 pospuesta»). El nombre sale de `nombres`
 * (paciente → nombre); sin nombre conocido se dice «Paciente».
 */
export function listaDePospuestas(
  pospuestas: readonly Posposicion[],
  ahora: Date,
  nombres: ReadonlyMap<string, string>,
): PospuestaVisible[] {
  return pospuestas
    .filter((p) => p.hasta.getTime() > ahora.getTime())
    .map((p) => ({
      patientId: p.patientId,
      patientName: nombres.get(p.patientId) ?? "Paciente",
      tipo: p.tipo,
      etiqueta: ETIQUETA_DE_TIPO[p.tipo],
      hasta: p.hasta.toISOString(),
    }))
    .sort((a, b) => a.patientName.localeCompare(b.patientName, "es") || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

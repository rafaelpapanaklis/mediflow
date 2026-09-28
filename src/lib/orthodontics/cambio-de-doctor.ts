// Ortodoncia — F «Cambio de doctor» (ws1-t10). Al reasignar el doctor tratante,
// los controles YA agendados se quedaban con el anterior. Estas reglas, puras y
// con test, deciden qué controles futuros se pueden pasar al doctor nuevo.

/** Estados de una cita que todavía no ocurrió (se puede mover de doctor). */
export const ESTADOS_DE_CITA_POR_VENIR = ["PENDING", "SCHEDULED", "CONFIRMED"] as const;

/** Estados de una cita que ocupan el tiempo del doctor. */
export const ESTADOS_QUE_OCUPAN_AGENDA = ["PENDING", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] as const;

export interface Franja {
  startsAt: Date;
  endsAt: Date;
}

/** ¿Dos franjas se traslapan? Que una termine justo cuando empieza la otra NO es traslape. */
export function seTraslapan(a: Franja, b: Franja): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

export interface ControlPorMover extends Franja {
  id: string;
}

/**
 * De los controles futuros, cuáles se pueden pasar al doctor nuevo (no chocan con
 * lo que ese doctor ya tiene) y cuáles no. Los que se mueven en la misma tanda
 * también cuentan entre sí: dos controles del mismo caso no se pisan.
 */
export function repartirControles(
  controles: ControlPorMover[],
  ocupadasDelDoctorNuevo: Franja[],
): { mover: ControlPorMover[]; conflicto: ControlPorMover[] } {
  const mover: ControlPorMover[] = [];
  const conflicto: ControlPorMover[] = [];
  const ocupadas = [...ocupadasDelDoctorNuevo];
  for (const c of [...controles].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())) {
    if (ocupadas.some((o) => seTraslapan(c, o))) {
      conflicto.push(c);
    } else {
      mover.push(c);
      ocupadas.push(c);
    }
  }
  return { mover, conflicto };
}

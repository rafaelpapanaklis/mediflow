"use client";

/**
 * useActiveConsult — Hook del Patient Context Bar.
 * TODO(Fase 2.3): implementar con Context Provider real.
 * Por ahora devuelve null; los consumidores ocultan acciones contextuales.
 */

export interface ActiveConsult {
  patientId: string;
  patientName: string;
  startedAt: Date;
  elapsedSeconds: number;
}

export function useActiveConsult(): ActiveConsult | null {
  return null;
}

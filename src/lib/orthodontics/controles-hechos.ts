// Ortodoncia — cuántos controles lleva un CASO (ws1-t12), para «Control X de N». PURO.
// Es la misma cuenta que la ficha (`visitasDelCaso`: una cita atendida y su hoja son la misma visita; dos hojas
// sueltas del mismo día también), pero acotada al caso: las citas de control son del PACIENTE, y un paciente
// puede haber tenido un caso anterior; solo cuentan las de esta colocación en adelante.

import { visitasDelCaso, type CitaDeControlDelCaso, type HojaDeControlDelCaso } from "./redesign/indicadores-del-caso";

/** El día (UTC) en que arrancó el caso: colocación, si no inicio planeado, si no cuando se abrió. */
export function inicioDelCaso(p: { installedAt: Date | null; startDate?: Date | null; createdAt?: Date | null }): Date | null {
  return p.installedAt ?? p.startDate ?? p.createdAt ?? null;
}

export function contarControlesHechos(args: {
  citas: readonly CitaDeControlDelCaso[];
  /** Las hojas de control DE ESTE CASO (ya vienen filtradas por caso). */
  hojas: readonly HojaDeControlDelCaso[];
  inicio: Date | null;
  ahora: Date;
  zona: string;
}): number {
  // Un día de margen: la colocación y su primer control pueden caer el mismo día en horas distintas.
  const desde = args.inicio ? new Date(args.inicio.getTime() - 86_400_000) : null;
  const citas = desde ? args.citas.filter((c) => c.startsAt >= desde) : [];
  return visitasDelCaso(citas, args.hojas, args.ahora, args.zona).total;
}

/**
 * ws1-t10: el número de ESTE control con la cuenta de la ficha. Si la visita ya cuenta entre los `hechos` (el paciente
 * ya llegó, o su hoja ya existe: la misma regla de `visitasDelCaso`) lleva el número que ya tiene; si no, es el que sigue.
 */
export function numeroDeEsteControl(a: { hechos: number; yaCuenta: boolean }): number {
  const h = Math.max(0, Math.floor(Number.isFinite(a.hechos) ? a.hechos : 0));
  return a.yaCuenta ? Math.max(1, h) : h + 1;
}

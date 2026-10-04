// ═══════════════════════════════════════════════════════════════════════════
// UNA definición de «CITAS DEL MES» (ws1-t2, auditoría de uso C-11; decisión 9
// de Rafael). Pura, sin Prisma (src/lib/agenda/__tests__/citas-del-periodo.test.ts).
//
// La auditoría vio cuatro «citas del mes» a la vez: Inicio 76, Finanzas 57,
// Analítica 85 y Reportes 104. Cada pantalla contaba otra cosa:
//   · Finanzas, solo hasta HOY (su ventana de cobros acaba en «ahora»);
//   · Analítica, desde el día 1 del mes del SERVIDOR y SIN fin (entraban las
//     citas de noviembre en adelante);
//   · Reportes, CON las canceladas.
// Ninguna lo decía. Desde aquí:
//
//   citas del mes = citas con fecha (`startsAt`) dentro del mes de calendario
//   de la CLÍNICA —el mes entero: las que ya pasaron, las de hoy y las que
//   faltan—, de cualquier estado SALVO canceladas («No asistió» sí cuenta: la
//   cita existió y ocupó su lugar).
//
// La misma regla vale para cualquier periodo (día, trimestre, rango): las
// citas de ese periodo entero, sin canceladas. Cada pantalla lo explica con el
// «Qué cuenta» `citasDelPeriodo`.
// ═══════════════════════════════════════════════════════════════════════════

import type { Prisma } from "@prisma/client";
import { periodRangeUtc } from "@/lib/agenda/time-utils";

/** Los estados que NO son una cita del periodo: la cancelada liberó su lugar. */
export const ESTADOS_QUE_NO_CUENTAN = ["CANCELLED"] as const;

/** `where` de las citas de `[desde, hasta)`. El `clinicId` lo pone quien llama, de la sesión. */
export function citasDelPeriodoWhere(clinicId: string, desde: Date, hasta: Date): Prisma.AppointmentWhereInput {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  return { clinicId, startsAt: { gte: desde, lt: hasta }, status: { notIn: [...ESTADOS_QUE_NO_CUENTAN] } };
}

/** El mes de calendario de la clínica que contiene `ahora` (o el de `desfase` meses antes/después), `[desde, hasta)`. */
export function mesDeLaClinica(zona: string, ahora: Date = new Date(), desfase = 0): { desde: Date; hasta: Date } {
  let { from, to } = periodRangeUtc("month", zona, ahora);
  for (let i = 0; i < Math.abs(desfase); i++) {
    ({ from, to } = periodRangeUtc("month", zona, desfase < 0 ? new Date(from.getTime() - 1) : to));
  }
  return { desde: from, hasta: to };
}

/** El día de calendario de la clínica que contiene `ahora`, `[desde, hasta)`. */
export function diaDeLaClinica(zona: string, ahora: Date = new Date()): { desde: Date; hasta: Date } {
  const { from, to } = periodRangeUtc("day", zona, ahora);
  return { desde: from, hasta: to };
}

/** ¿La cita cuenta? (para contar filas ya cargadas con la misma regla). */
export function citaCuentaEnElPeriodo(status: string): boolean {
  return !(ESTADOS_QUE_NO_CUENTAN as readonly string[]).includes(status);
}

// ¿Qué citas nacieron de la fila de espera? (ws1-t1, ronda de arreglos de la auditoría de uso — C-97)
//
// EL FALLO QUE CIERRA: la cita que crea «Iniciar» en la fila de walk-in llegaba a la agenda con
// `isWalkIn: false` (appointmentToDTO lo fijaba así) y «Origen: En la clínica»: no se distinguía de una cita
// agendada.
//
// La liga fila → cita es la columna `walk_in_queue."appointmentId"` (sql/ws1-t4-walkin-cita.sql, la pega
// Rafael), que el modelo de Prisma NO declara a propósito. Mientras no exista se usa la otra pista que deja
// `iniciar-consulta.ts`: la fila y la cita llevan el MISMO paciente y el MISMO `startedAt`. Una sola consulta
// por rango de agenda, nunca por tarjeta, y nunca lanza: la agenda no se rompe por una marca.

import { prisma } from "@/lib/prisma";

const g = globalThis as { __walkInSinLiga?: boolean };

export interface CitaParaWalkIn {
  id: string;
  patientId: string | null | undefined;
  startedAt: Date | string | null | undefined;
}

/** Empareja por paciente + instante de inicio (la pista sin la columna de la liga). Puro, para probarlo. */
export function emparejarPorInicio(
  citas: CitaParaWalkIn[],
  filas: Array<{ patientId: string | null; startedAt: Date | null }>,
): Set<string> {
  const claves = new Set(
    filas
      .filter((f) => f.patientId && f.startedAt)
      .map((f) => `${f.patientId}|${new Date(f.startedAt as Date).getTime()}`),
  );
  const out = new Set<string>();
  for (const c of citas) {
    if (!c.patientId || !c.startedAt) continue;
    if (claves.has(`${c.patientId}|${new Date(c.startedAt).getTime()}`)) out.add(c.id);
  }
  return out;
}

export async function citasDeWalkIn(clinicId: string, citas: CitaParaWalkIn[]): Promise<Set<string>> {
  // (c) de la casa: sin clinicId no se consulta.
  if (!clinicId || citas.length === 0) return new Set();
  try {
    if (!g.__walkInSinLiga) {
      try {
        const ids = citas.map((c) => c.id);
        const filas = await prisma.$queryRaw<Array<{ appointmentId: string }>>`
          SELECT "appointmentId" FROM walk_in_queue
          WHERE "clinicId" = ${clinicId} AND "appointmentId" = ANY(${ids})`;
        return new Set(filas.map((f) => f.appointmentId));
      } catch {
        // Sin la columna (SQL sin pegar): una sola vez por proceso, sin bucles de error en los logs.
        g.__walkInSinLiga = true;
      }
    }
    const conInicio = citas.filter((c) => c.patientId && c.startedAt);
    if (conInicio.length === 0) return new Set();
    const filas = await prisma.walkInQueue.findMany({
      where: {
        clinicId,
        patientId: { in: Array.from(new Set(conInicio.map((c) => c.patientId as string))) },
        startedAt: { in: conInicio.map((c) => new Date(c.startedAt as Date | string)) },
      },
      select: { patientId: true, startedAt: true },
    });
    return emparejarPorInicio(conInicio, filas);
  } catch (e) {
    console.error("[walk-in/citas-de-walk-in]", e);
    return new Set();
  }
}

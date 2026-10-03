// La fila de walk-in se cierra también cuando su cita se cierra POR LA AGENDA (ws1-t1, arreglos de las
// revisiones, 3-oct-2026).
//
// `cerrar-con-cita.ts` cubre un sentido: «Completar»/«Cancelar» en la fila cierran la cita. Faltaba el otro: si
// la cita que creó «Iniciar» se completaba, se cancelaba o se marcaba «No asistió» desde la Agenda (o con
// «Terminar consulta» en la ficha), la fila seguía «En atención» para siempre y había que cancelarla a mano.
//
//   cita COMPLETED          → fila COMPLETED (completedAt = ahora)
//   cita CANCELLED/NO_SHOW  → fila CANCELLED
//
// Solo se mueve una fila «En atención» (IN_PROGRESS) de la MISMA clínica: la ligada por la columna
// `walk_in_queue."appointmentId"` (sql/ws1-t4-walkin-cita.sql) o, sin ella, la del mismo paciente con
// `startedAt` IDÉNTICO al de la cita (iniciar-consulta.ts escribe el mismo instante en las dos). Una cita normal
// de la agenda no tiene fila con ese instante, así que no toca nada.
//
// Se llama DESPUÉS de confirmar el cambio de la cita y fuera de su transacción: si la columna de la liga no
// existe, un error de SQL dentro de la transacción la abortaría entera. Nunca lanza: la cita ya cambió y eso es
// lo que importa; la fila es un reflejo.
import { prisma } from "@/lib/prisma";

export type EstadoQueCierra = "COMPLETED" | "CANCELLED" | "NO_SHOW";

const g = globalThis as { __walkInSinLiga?: boolean };

/** Qué escribe en la fila cada cierre de la cita (null = ese estado no cierra la fila). */
export function datosDeLaFila(estado: string, ahora: Date): { status: "COMPLETED"; completedAt: Date } | { status: "CANCELLED" } | null {
  if (estado === "COMPLETED") return { status: "COMPLETED", completedAt: ahora };
  if (estado === "CANCELLED" || estado === "NO_SHOW") return { status: "CANCELLED" };
  return null;
}

/** Cierra la fila de walk-in de esta cita. Devuelve cuántas filas cerró (0 casi siempre: la mayoría de las citas no son walk-in). */
export async function cerrarFilaDeLaCita(args: {
  clinicId: string;
  appointmentId: string;
  estado: string;
  ahora?: Date;
}): Promise<number> {
  const { clinicId, appointmentId } = args;
  if (!clinicId || !appointmentId) return 0;
  const datos = datosDeLaFila(args.estado, args.ahora ?? new Date());
  if (!datos) return 0;
  let cerradas = 0;
  try {
    if (!g.__walkInSinLiga) {
      try {
        cerradas += Number(
          datos.status === "COMPLETED"
            ? await prisma.$executeRaw`UPDATE walk_in_queue SET status = 'COMPLETED', "completedAt" = ${datos.completedAt}
                WHERE "clinicId" = ${clinicId} AND "appointmentId" = ${appointmentId} AND status = 'IN_PROGRESS'`
            : await prisma.$executeRaw`UPDATE walk_in_queue SET status = 'CANCELLED'
                WHERE "clinicId" = ${clinicId} AND "appointmentId" = ${appointmentId} AND status = 'IN_PROGRESS'`,
        ) || 0;
      } catch {
        // Sin la columna (SQL sin pegar): una sola vez por proceso, sin bucles de error en los logs.
        g.__walkInSinLiga = true;
      }
    }
    if (cerradas > 0) return cerradas;
    const cita = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: { patientId: true, startedAt: true },
    });
    if (!cita?.patientId || !cita.startedAt) return 0;
    const r = await prisma.walkInQueue.updateMany({
      where: { clinicId, patientId: cita.patientId, startedAt: cita.startedAt, status: "IN_PROGRESS" },
      data: datos,
    });
    return r.count;
  } catch (e) {
    console.error("[walk-in] cerrar la fila de la cita:", e);
    return cerradas;
  }
}

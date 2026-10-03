// «Completar» y «Cancelar» de la fila de walk-in cierran TAMBIÉN la cita que creó «Iniciar» (ws1-t4, fallo 3 de
// la revisión final, 2-oct-2026).
//
// Antes solo cambiaban la fila: la cita quedaba «En consulta» para siempre en la Agenda y en Hoy, y recepción no
// la podía cerrar desde ahí (la máquina de estados de citas no le deja pasar IN_PROGRESS → COMPLETED). Ahora la
// fila y su cita se mueven en la MISMA transacción:
//
//   Completar → la cita abierta pasa a COMPLETED (completedAt), termina a la hora real (endsAt = ahora si era
//               más tarde) y sale la invitación a reseña, igual que al
//               cerrarla por la Agenda (decisión 11.2 de ws1-t4).
//   Cancelar  → la cita abierta pasa a CANCELLED (cancelledAt + motivo). SIN WhatsApp de cancelación: el paciente
//               está en la clínica. La cita de un walk-in no tiene recordatorios ni anticipo, pero se cancelan
//               los recordatorios pendientes por si alguien se los puso después.
//
// La cita es la que la propia fila creó, así que se cierra con el permiso de la fila (agenda.edit; cancelar una
// fila que ya tiene cita pide además agenda.delete, como cancelar una cita) y NO con la matriz de roles de
// `transitions.ts`: «Iniciar» tampoco pasa por ella al crearla en consulta. Si la cita ya se cerró o se movió
// por la Agenda (completada, cancelada, no asistió), no se toca: solo se cierra la fila.
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";

/** Estados en los que la cita del walk-in sigue «abierta» y la fila la arrastra al cerrarse. */
export const CITA_ABIERTA = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] as const;
/** Completar solo cierra una cita que ya empezó (llegó / en sillón / en consulta). */
const CITA_EN_CURSO = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] as const;

export const MOTIVO_CANCELADA_DESDE_LA_FILA = "Cancelada desde la fila de espera";

export type FilaACerrar = {
  id: string;
  clinicId: string;
  patientId: string | null;
  assignedTo: string | null;
  startedAt: Date | null;
};

const g = globalThis as { __walkInSinLiga?: boolean };

/**
 * La cita que creó «Iniciar» para esta fila. Primero la liga `walk_in_queue."appointmentId"` (columna de
 * sql/ws1-t4-walkin-cita.sql, fuera del modelo de Prisma a propósito); si la columna no existe o está vacía, la
 * cita de ese paciente cuyo `startedAt` es EXACTAMENTE el de la fila (iniciar-consulta.ts escribe el mismo
 * instante en las dos). Siempre con el `clinicId` de la sesión.
 */
export async function citaDeLaFila(tx: any, fila: FilaACerrar): Promise<string | null> {
  if (!fila.clinicId) return null;
  if (!g.__walkInSinLiga) {
    try {
      const filas: Array<{ appointmentId: string | null }> = await tx.$queryRaw`
        SELECT "appointmentId" FROM walk_in_queue WHERE id = ${fila.id} AND "clinicId" = ${fila.clinicId}`;
      const ligada = filas[0]?.appointmentId;
      if (ligada) {
        const c = await tx.appointment.findFirst({ where: { id: ligada, clinicId: fila.clinicId }, select: { id: true } });
        if (c) return c.id;
      }
    } catch {
      // Sin la columna: una sola vez por proceso, sin bucles de error en los logs.
      g.__walkInSinLiga = true;
    }
  }
  if (!fila.patientId || !fila.startedAt) return null;
  const c = await tx.appointment.findFirst({
    where: { clinicId: fila.clinicId, patientId: fila.patientId, startedAt: fila.startedAt },
    select: { id: true },
  });
  return c?.id ?? null;
}

export type ResultadoCerrar =
  | { ok: true; citaId: string | null; citaCerrada: boolean }
  | { ok: false; status: number; body: Record<string, unknown> };

class FilaYaMovida extends Error {}

export async function cerrarFilaConSuCita(args: {
  req: NextRequest;
  actor: { userId: string; clinicId: string };
  fila: FilaACerrar;
  accion: "complete" | "cancel";
  /** Estados desde los que la fila puede moverse (los de la acción en la ruta). */
  desde: readonly string[];
}): Promise<ResultadoCerrar> {
  const { req, actor, fila, accion } = args;
  const clinicId = actor.clinicId;
  if (!clinicId) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  const ahora = new Date();
  let citaId: string | null = null;
  let citaCerrada = false;

  try {
    await prisma.$transaction(async (tx: any) => {
      const { count } = await tx.walkInQueue.updateMany({
        where: { id: fila.id, clinicId, status: { in: [...args.desde] } },
        data: accion === "complete" ? { status: "COMPLETED", completedAt: ahora } : { status: "CANCELLED" },
      });
      if (count === 0) throw new FilaYaMovida();

      citaId = await citaDeLaFila(tx, { ...fila, clinicId });
      if (!citaId) return;
      // Completar termina la cita A LA HORA REAL (vuelta 2, 2-oct-2026): si se cierra antes de su fin, `endsAt`
      // pasa a ahora. La constraint de no-solape de la base (appt_doctor_no_overlap, la de toda la Agenda) cuenta
      // también las COMPLETADAS; sin esto el resto de su hueco seguía apartado y «Iniciar» el siguiente walk-in
      // del mismo doctor daba 409. La regla de la Agenda no se toca: solo se acorta la cita que la fila creó.
      let finReal: Date | undefined;
      if (accion === "complete") {
        const horario = await tx.appointment.findFirst({
          where: { id: citaId, clinicId },
          select: { startsAt: true, endsAt: true },
        });
        if (horario && horario.endsAt > ahora && horario.startsAt < ahora) finReal = ahora;
      }
      const r = await tx.appointment.updateMany({
        where: {
          id: citaId,
          clinicId,
          status: { in: accion === "complete" ? [...CITA_EN_CURSO] : [...CITA_ABIERTA] },
        },
        data:
          accion === "complete"
            ? { status: "COMPLETED", completedAt: ahora, ...(finReal ? { endsAt: finReal } : {}) }
            : { status: "CANCELLED", cancelledAt: ahora, cancelReason: MOTIVO_CANCELADA_DESDE_LA_FILA },
      });
      citaCerrada = r.count === 1;
      if (citaCerrada && accion === "cancel") {
        // Import perezoso: solo cuando hay una cita que cancelar (la ruta de la fila no carga los recordatorios).
        const { cancelPendingRemindersForAppointment } = await import("@/lib/reminders/reschedule.server");
        await cancelPendingRemindersForAppointment(tx, {
          appointmentId: citaId,
          clinicId,
          reason: "Cancelado: la cita se canceló",
        });
      }
    });
  } catch (err) {
    if (err instanceof FilaYaMovida) return { ok: false, status: 409, body: { error: "invalid_transition" } };
    throw err;
  }

  if (citaId && citaCerrada) {
    await logMutation({
      req,
      clinicId,
      userId: actor.userId,
      entityType: "appointment",
      entityId: citaId,
      action: "update",
      patientId: fila.patientId,
      after: { status: accion === "complete" ? "COMPLETED" : "CANCELLED", origen: "walk-in", walkInId: fila.id },
    });
    if (accion === "complete") {
      // Idempotente (una por cita) y nunca lanza: lo mismo que al cerrar la cita por la Agenda.
      const { sendReviewInvitation } = await import("@/lib/reviews/invite");
      await sendReviewInvitation(citaId);
    }
    try {
      const { revalidateAfter } = await import("@/lib/cache/revalidate");
      revalidateAfter("appointments");
    } catch { /* fuera de Next (pruebas) no hay caché que invalidar */ }
  }
  return { ok: true, citaId, citaCerrada };
}

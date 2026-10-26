// WS1-T3 v7 (revisión t8 de la v6) — lo que el paciente le hace a su cita al
// contestar CONFIRMAR o CANCELAR a un recordatorio de WhatsApp.
//
// El webhook elige el recordatorio solo si su cita sigue en un estado que
// admite respuesta (`WA_REMINDER_REPLYABLE_APPT_STATUSES`), pero escribía con
// `where: { id }` a secas: si la clínica la cancelaba (o le marcaba la llegada)
// en los milisegundos entre la lectura y la escritura, la respuesta del
// paciente la revivía como CONFIRMED o cancelaba una cita en curso. Ahora la
// escritura repite ese filtro (y el clinicId): `false` = no tocó la cita, y el
// webhook se lo dice al paciente sin más efectos.
//
// Sin Prisma ni Next: recibe la base (el `prisma` de siempre o un doble).

import { WA_REMINDER_REPLYABLE_APPT_STATUSES } from "./reminder-status";

type UpdateMany = { updateMany(args: any): Promise<{ count: number }> };
export interface DbRespuestaCita {
  appointment: UpdateMany;
  $transaction<T>(fn: (tx: { appointment: UpdateMany }) => Promise<T>): Promise<T>;
}

const sigueViva = (clinicId: string, appointmentId: string) => ({
  id: appointmentId,
  clinicId,
  status: { in: WA_REMINDER_REPLYABLE_APPT_STATUSES },
});

/** CONFIRMAR: solo si la cita sigue admitiendo respuesta. */
export async function confirmarCitaDelRecordatorio(
  db: DbRespuestaCita,
  d: { clinicId: string; appointmentId: string; ahora: Date },
): Promise<boolean> {
  const r = await db.appointment.updateMany({
    where: sigueViva(d.clinicId, d.appointmentId),
    data: { status: "CONFIRMED", confirmedAt: d.ahora },
  });
  return r.count === 1;
}

/**
 * CANCELAR: solo si la cita sigue admitiendo respuesta; en la MISMA
 * transacción, `alCancelar` (los recordatorios en cola de esa cita), y solo si
 * de verdad se canceló.
 */
export async function cancelarCitaDelRecordatorio<Tx extends { appointment: UpdateMany }>(
  db: { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> },
  d: { clinicId: string; appointmentId: string; ahora: Date },
  alCancelar: (tx: Tx) => Promise<unknown>,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.appointment.updateMany({
      where: sigueViva(d.clinicId, d.appointmentId),
      data: { status: "CANCELLED", cancelledAt: d.ahora, cancelReason: "Cancelado por paciente vía WhatsApp" },
    });
    if (r.count !== 1) return false;
    await alCancelar(tx);
    return true;
  });
}

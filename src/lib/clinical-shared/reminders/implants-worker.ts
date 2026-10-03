// Implantes — encolador diario de los ClinicalReminder de implantes (module=implants, set v2) hacia la cola de
// WhatsApp. Lo llama /api/cron/implants-reminders (vercel.json, 06:15 MX).
//
// Revisado al programarlo en vercel.json (ws1-t1, 3-oct-2026: el cron existía pero nunca corría). Lo que se
// corrigió respecto de la ruta original, que no se podía encender tal cual:
//   · Sin borde inferior: el primer día habría encolado todo el atraso. La cola expira (CANCELLED) lo que tiene
//     `scheduledFor` de hace más de 7 días, así que esos quedaban «enviados» en la ficha sin salir nunca. Ahora la
//     misma ventana que clinical-reminders (MAX_OVERDUE_DAYS): lo más viejo se queda en `pending`, a la vista.
//   · Sin transacción ni reclamo: un fallo entre crear el mensaje y marcar el recordatorio, o dos corridas a la
//     vez, encolaban el mismo aviso dos veces. Ahora el recordatorio se RECLAMA (pending → sent con el estado en
//     el where) y el mensaje se crea en la MISMA transacción.
//   · Los que nunca se pueden mandar (clínica sin recordatorios o sin WhatsApp, paciente sin teléfono o borrado,
//     tipo sin plantilla) se filtran en la consulta: antes se saltaban sin cambiar de estado y, con `take` sin
//     orden, podían tapar el lote cada día.
//   · Con orden por fecha (lo más urgente primero).
//
// No se cruza con clinical-reminders: ese solo encola tipos de periodoncia (plan.ts, ENQUEUEABLE_TYPES).

import { prisma } from "@/lib/prisma";
import { renderImplantReminderMessage } from "@/lib/clinical-shared/reminder-rules";
import type { ImplantReminderRuleKey } from "@/lib/clinical-shared/types";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import { oldestEnqueueableDueDate } from "./plan";

/** Cuánto por delante se encola (el mensaje sale a su hora: `scheduledFor` = dueDate). */
export const VENTANA_ADELANTE_HORAS = 24;
const LOTE = 500;

/** reminderType (set v2) → regla con plantilla. Los legacy `implant_followup_*` no tienen plantilla aquí. */
export const REGLA_POR_TIPO = {
  implant_cicatrizacion_7d: "control_cicatrizacion_7d",
  implant_retiro_sutura_10d: "retiro_sutura_10d",
  implant_oseointegracion_4m: "control_oseointegracion_4m",
  implant_control_anual: "control_anual_implante",
  implant_peri_implantitis_6m: "control_peri_implantitis_6m",
} as const satisfies Record<string, ImplantReminderRuleKey>;

export type TipoConPlantilla = keyof typeof REGLA_POR_TIPO;
export const TIPOS_CON_PLANTILLA = Object.keys(REGLA_POR_TIPO) as TipoConPlantilla[];

export interface ResumenImplantes {
  found: number;
  enqueued: number;
  /** Otro proceso ya lo había reclamado (corrida doble): no se duplica. */
  alreadyTaken: number;
  errors: number;
  examples: Array<{ id: string; reminderType: string; dueDate: string }>;
}

/** La ventana de fechas que se encola: [ahora − 7 días, ahora + 24 h]. */
export function ventanaDeImplantes(ahora: Date): { desde: Date; hasta: Date } {
  return {
    desde: oldestEnqueueableDueDate(ahora),
    hasta: new Date(ahora.getTime() + VENTANA_ADELANTE_HORAS * 3600 * 1000),
  };
}

export async function processImplantReminders(opts?: { now?: Date; batchSize?: number }): Promise<ResumenImplantes> {
  const ahora = opts?.now ?? new Date();
  const { desde, hasta } = ventanaDeImplantes(ahora);
  const resumen: ResumenImplantes = { found: 0, enqueued: 0, alreadyTaken: 0, errors: 0, examples: [] };

  const pendientes = await prisma.clinicalReminder.findMany({
    where: {
      module: "implants",
      status: "pending",
      deletedAt: null,
      reminderType: { in: TIPOS_CON_PLANTILLA },
      dueDate: { gte: desde, lte: hasta },
      clinic: { waReminderActive: true, waConnected: true },
      patient: { deletedAt: null, phone: { not: null } },
    },
    orderBy: { dueDate: "asc" },
    take: opts?.batchSize ?? LOTE,
    select: {
      id: true,
      clinicId: true,
      reminderType: true,
      dueDate: true,
      payload: true,
      patient: { select: { firstName: true, phone: true } },
    },
  });
  resumen.found = pendientes.length;

  for (const r of pendientes) {
    const regla = REGLA_POR_TIPO[r.reminderType as TipoConPlantilla];
    const telefono = r.patient?.phone;
    if (!regla || !telefono) continue;
    const payload =
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : {};
    const mensaje = renderImplantReminderMessage(regla, {
      patientName: r.patient.firstName ?? "",
      toothFdi: typeof payload.toothFdi === "number" ? payload.toothFdi : "",
    });

    try {
      const tomado = await prisma.$transaction(async (tx) => {
        // Reclamo: solo una corrida pasa este updateMany (el estado va en el where).
        const reclamo = await tx.clinicalReminder.updateMany({
          where: { id: r.id, clinicId: r.clinicId, status: "pending" },
          data: { status: "sent", triggeredAt: ahora },
        });
        if (reclamo.count !== 1) return false;
        const wa = await tx.whatsAppReminder.create({
          data: {
            clinicId: r.clinicId,
            patientPhone: telefono,
            message: mensaje,
            payload: { ...payload, implantReminderRuleKey: regla, sourceClinicalReminderId: r.id },
            type: "IMPLANT",
            status: WA_REMINDER_STATUS.PENDING,
            scheduledFor: r.dueDate,
          },
          select: { id: true },
        });
        await tx.clinicalReminder.updateMany({
          where: { id: r.id, clinicId: r.clinicId },
          data: { whatsappReminderId: wa.id },
        });
        return true;
      });
      if (!tomado) {
        resumen.alreadyTaken += 1;
        continue;
      }
      resumen.enqueued += 1;
      if (resumen.examples.length < 5) {
        resumen.examples.push({ id: r.id, reminderType: r.reminderType, dueDate: r.dueDate.toISOString() });
      }
    } catch (err) {
      resumen.errors += 1;
      console.error("[cron/implants-reminders] error", r.id, err);
    }
  }
  return resumen;
}

// Clinical-shared — decisión PURA de qué hace el encolador con cada
// ClinicalReminder. Sin Prisma ni red: se prueba sola, cruzada contra el
// `renderMessage` real de la cola (ver __tests__/plan.test.ts).
//
// Por qué existe: el encolador resolvía la plantilla contra un catálogo que
// solo conoce claves `ped_*` y `ortho_*`, y las únicas filas que el producto
// crea de verdad son de periodoncia (`perio_maintenance_*`). Ninguna casaba →
// `skipped++` sin tocar el status → el cron corría a diario y no encolaba nada.
//
// Regla de este archivo: SOLO se encola un mensaje que la cola sabe convertir
// en texto para el paciente. Lo que la cola no sabe renderizar NO se encola
// (antes se habría marcado `sent` en la clínica y muerto en silencio en la
// cola, o peor: salido en crudo).

import type { ClinicalReminderType } from "@prisma/client";

/**
 * Tipos que el encolador sabe convertir en un mensaje que la cola renderiza.
 * Es también el filtro de la consulta: lo que no está aquí ni se lee, así no
 * tapona el lote (el barrido es `take N` por fecha, y una fila que se salta
 * sin cambiar de estado vuelve a salir la primera cada día).
 */
export const ENQUEUEABLE_TYPES = [
  "perio_maintenance_3m",
  "perio_maintenance_4m",
  "perio_maintenance_6m",
] as const satisfies readonly ClinicalReminderType[];

const PERIO_MAINTENANCE_MONTHS: Record<(typeof ENQUEUEABLE_TYPES)[number], number> = {
  perio_maintenance_3m: 3,
  perio_maintenance_4m: 4,
  perio_maintenance_6m: 6,
};

/**
 * Un recordatorio vencido hace más que esto NO se encola: la cola expira todo
 * pendiente con `scheduledFor` de hace más de 7 días (STALE_AFTER_MS en
 * queue-worker.ts), así que encolarlo solo serviría para marcarlo `sent` sin
 * que saliera nada. Se queda en `pending`, a la vista, para que lo decida una
 * persona. Es también lo que impide que el primer día tras este arreglo salga
 * de golpe el atraso de meses.
 */
export const MAX_OVERDUE_DAYS = 7;

export type ReminderPlan =
  | {
      action: "enqueue";
      /** Clave con prefijo que `renderMessage` de la cola sabe resolver. */
      message: string;
      /** Valor de WhatsAppReminder.type. */
      type: string;
      payload: Record<string, unknown>;
    }
  | { action: "skip"; reason: string };

export function planClinicalReminder(r: {
  reminderType: string;
  payload: unknown;
}): ReminderPlan {
  const months = PERIO_MAINTENANCE_MONTHS[r.reminderType as keyof typeof PERIO_MAINTENANCE_MONTHS];
  if (!months) {
    return { action: "skip", reason: `sin plantilla que la cola sepa renderizar: ${r.reminderType}` };
  }
  const base =
    r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : {};
  return {
    action: "enqueue",
    message: "PERIO_PRE_MAINTENANCE",
    type: "PERIO",
    payload: { ...base, months },
  };
}

/** Borde inferior de la ventana del encolador (ver MAX_OVERDUE_DAYS). */
export function oldestEnqueueableDueDate(now: Date): Date {
  return new Date(now.getTime() - MAX_OVERDUE_DAYS * 24 * 3600 * 1000);
}

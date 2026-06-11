// Estados y frecuencias canónicos de PaymentPlan (payment_plans).
//
// Las columnas payment_plans.status y payment_plans.frequency son TEXT en la
// base real (la tabla se creó vía sql/migration_features6.sql, nunca con
// prisma migrate); los types de Postgres "PlanStatus" y "PaymentFrequency"
// JAMÁS existieron en prod — mismo drift que tronó el cron whatsapp-queue
// (42704). El schema modela ambos campos como String; centraliza aquí los
// valores para no regar literales.
//
// A diferencia de whatsapp_reminders, aquí NO hay valores legacy: la tabla
// nace con DEFAULT 'ACTIVE' / 'MONTHLY' y el código siempre escribió estos
// mismos valores en mayúsculas. OVERDUE está reservado (ningún flujo lo
// escribe hoy, pero es estado documentado del plan).

export const PLAN_STATUS = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  OVERDUE: "OVERDUE",
} as const;

export type PlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

export const PLAN_FREQUENCY = {
  WEEKLY: "WEEKLY",
  BIWEEKLY: "BIWEEKLY",
  MONTHLY: "MONTHLY",
} as const;

export type PlanFrequency =
  (typeof PLAN_FREQUENCY)[keyof typeof PLAN_FREQUENCY];

// Para WHEREs de "plan vivo/cobrable": un plan atrasado (OVERDUE) sigue
// vigente y cobrable, solo COMPLETED/CANCELLED quedan fuera.
export const PLAN_OPEN_STATUSES: string[] = [
  PLAN_STATUS.ACTIVE,
  PLAN_STATUS.OVERDUE,
];

// Días entre cuotas por frecuencia (MONTHLY se aproxima a 30 días, igual
// que el cálculo histórico de installments).
export const PLAN_FREQUENCY_DAYS: Record<string, number> = {
  [PLAN_FREQUENCY.WEEKLY]: 7,
  [PLAN_FREQUENCY.BIWEEKLY]: 14,
  [PLAN_FREQUENCY.MONTHLY]: 30,
};

// Orthodontics — tipos compartidos derivados de Prisma + tipos UI. SPEC §4.

import type { Prisma } from "@prisma/client";

// ─── Re-export de enums Prisma para que los componentes no importen
//     directo del cliente Prisma (evita acoplamiento + simplifica imports). ──
export type {
  AngleClass,
  OrthoTechnique,
  AnchorageType,
  OrthoPhaseKey,
  OrthoPhaseStatus,
  OrthoTreatmentStatus,
  OrthoPaymentStatus,
  InstallmentStatus,
  OrthoPhotoSetType,
  HabitType,
  DentalPhase,
  TreatmentObjective,
  OrthoConsentType,
  ControlAttendance,
  AdjustmentType,
  OrthoPaymentMethod,
  DigitalRecordType,
} from "@prisma/client";

// `OrthoPhotoView` vive en TS-only (no se genera en Prisma client porque
// no hay columna que lo use). Se re-exporta desde photo-set-helpers.
export type { OrthoPhotoView } from "@/lib/orthodontics/photo-set-helpers";

// ─── Filas Prisma planas ────────────────────────────────────────────
export type OrthodonticDiagnosisRow = Prisma.OrthodonticDiagnosisGetPayload<{}>;
export type OrthodonticTreatmentPlanRow = Prisma.OrthodonticTreatmentPlanGetPayload<{}>;
export type OrthodonticPhaseRow = Prisma.OrthodonticPhaseGetPayload<{}>;
export type OrthoPaymentPlanRow = Prisma.OrthoPaymentPlanGetPayload<{}>;
export type OrthoInstallmentRow = Prisma.OrthoInstallmentGetPayload<{}>;
export type OrthoPhotoSetRow = Prisma.OrthoPhotoSetGetPayload<{}>;
export type OrthodonticControlAppointmentRow =
  Prisma.OrthodonticControlAppointmentGetPayload<{}>;
export type OrthodonticDigitalRecordRow = Prisma.OrthodonticDigitalRecordGetPayload<{}>;
export type OrthodonticConsentRow = Prisma.OrthodonticConsentGetPayload<{}>;

// ─── Filas con relaciones para queries del kanban y vistas ──────────
export type OrthoTreatmentPlanFull = Prisma.OrthodonticTreatmentPlanGetPayload<{
  include: {
    diagnosis: true;
    phases: { orderBy: { orderIndex: "asc" } };
    paymentPlan: { include: { installments: { orderBy: { installmentNumber: "asc" } } } };
    controls: { orderBy: { monthInTreatment: "desc" } };
    photoSets: { orderBy: { capturedAt: "desc" } };
    digitalRecords: { orderBy: { capturedAt: "desc" } };
    consents: true;
    patient: { select: { id: true; firstName: true; lastName: true; dob: true } };
  };
}>;

export type OrthoPhotoSetWithFiles = Prisma.OrthoPhotoSetGetPayload<{
  include: {
    photoFrontal: true;
    photoProfile: true;
    photoSmile: true;
    photoIntraFrontal: true;
    photoIntraLateralR: true;
    photoIntraLateralL: true;
    photoOcclusalUpper: true;
    photoOcclusalLower: true;
  };
}>;

// ─── Tipos UI compartidos ───────────────────────────────────────────

/**
 * Card del kanban a nivel clínica. SPEC §6.3.
 * Construida por kanban-helpers.ts a partir de queries Prisma agregadas.
 */
export interface OrthoKanbanCard {
  treatmentPlanId: string;
  patientId: string;
  patientName: string;
  patientPhotoUrl?: string | null;
  monthInTreatment: number;
  estimatedDurationMonths: number;
  /** Progreso 0-100 derivado de monthInTreatment / estimatedDurationMonths. */
  progressPct: number;
  currentPhaseKey: import("@prisma/client").OrthoPhaseKey;
  technique: import("@prisma/client").OrthoTechnique;
  doctorName?: string | null;
  /** Siguiente cita programada — ISO date string formato corto. */
  nextAppointmentAt?: string | null;
  /** Compliance derivada de los últimos 3 controles. */
  compliance: ComplianceSummary;
  /** Estado del plan de pagos. */
  paymentStatus: import("@prisma/client").OrthoPaymentStatus;
  /** Monto adeudado en MXN. 0 si ON_TIME. */
  amountOverdueMxn: number;
  /** Días vencidos del installment más antiguo sin pago. 0 si ON_TIME. */
  daysOverdue: number;
}

export type ComplianceSummary =
  | { level: "ok"; attended: 3 }
  | { level: "warning"; attended: 1 | 2; lastNoShow?: Date | null }
  | { level: "danger"; attended: 0; lastNoShow?: Date | null }
  | { level: "insufficient"; attended: number };

/**
 * Métricas agregadas para mostrar en `PaymentDelayWidget`. SPEC §6.2.
 */
export interface PaymentDelaySummary {
  totalActivePlans: number;
  onTimeCount: number;
  lightDelayCount: number;
  severeDelayCount: number;
  totalOverdueMxn: number;
}

/**
 * Pareo de fotos T0/T1/T2 para `PhotoCompareSlider`. SPEC §6.7.
 */
export interface PhotoComparePair {
  view: import("@/lib/orthodontics/photo-set-helpers").OrthoPhotoView;
  beforeFileId: string | null;
  beforeUrl: string | null;
  afterFileId: string | null;
  afterUrl: string | null;
}

/**
 * Result type compartido entre client/server. Re-exportado desde
 * `src/app/actions/orthodontics/result.ts`. Aquí se duplica el shape
 * para que los componentes lo importen sin ir al barrel.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: unknown };

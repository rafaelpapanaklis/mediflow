// Orthodontics — types compartidos por el ComparisonPdf y la action que
// lo consume. Separado del .tsx para que server actions puedan importar
// los tipos sin arrastrar @react-pdf/renderer al bundle de la action.

import type { PHOTO_VIEW_ORDER } from "../photo-set-helpers";

export interface ComparisonPdfPhotoSet {
  label: string;
  capturedAtIso: string;
  monthInTreatment: number | null;
  pairs: Array<{
    view: (typeof PHOTO_VIEW_ORDER)[number];
    url: string | null;
  }>;
}

export interface ComparisonPdfData {
  patientName: string;
  patientDobIso: string | null;
  doctorName: string;
  doctorCedula: string | null;
  clinicName: string;
  techniqueLabel: string;
  durationMonthsActual: number;
  estimatedDurationMonths: number;
  diagnosisSummary: string;
  retentionPlanText: string;
  initialSet: ComparisonPdfPhotoSet | null;
  midSets: ComparisonPdfPhotoSet[];
  finalSet: ComparisonPdfPhotoSet | null;
  generatedAtIso: string;
  hasPhotoUseConsent: boolean;
}

"use client";

// Pantalla "Resultado" — resumen honesto (todo bien / una parte / nada) + qué falló y por qué + reporte descargable + CTAs.
import { Check, AlertCircle, Users, Upload } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { DATA_TYPES, type CommitResult, type Entity } from "./import-client";
import { ErroresDeImportacion } from "./errores-de-importacion";

/** Etiqueta de la pill de cada entidad (shell.importClinic.result.*). */
const PILL_KEY: Record<Entity, string> = {
  patients: "pillPatients",
  balances: "pillBalances",
  appointments: "pillAppointments",
  medicalHistory: "pillMedicalHistory",
  clinicalNotes: "pillClinicalNotes",
  quotes: "pillQuotes",
  treatmentPlans: "pillTreatmentPlans",
  odontogram: "pillOdontogram",
  treatmentNotes: "pillTreatmentNotes",
  paymentHistory: "pillPaymentHistory",
  doctors: "pillDoctors",
  blockedHours: "pillBlockedHours",
  appointmentHistory: "pillAppointmentHistory",
  orthoCases: "pillOrthoCases",
  labExpenseHistory: "pillLabExpenseHistory",
  installmentPlans: "pillInstallmentPlans",
  procedureCatalog: "pillProcedureCatalog",
};

interface Props {
  t: TFunction;
  result: CommitResult;
  onGoPatients: () => void;
  onImportAnother: () => void;
  /** Descarga del reporte de errores (CSV armado en el navegador con `result.errorRows`). */
  onDownloadReport: () => void;
}

export function ResultPanel({ t, result, onGoPatients, onImportAnother, onDownloadReport }: Props) {
  const { created, errors, summary, omitted = 0, errorRows = [] } = result;
  // Con errores el título y la frase no pueden decir «correctamente»: si NADA entró, se dice; si entró una parte, también.
  const nada = errors > 0 && created === 0;
  const parcial = errors > 0 && created > 0;
  const titulo = nada ? "titleNothing" : parcial ? "titleErrors" : "title";
  return (
    <div className="imp-result">
      <div className="imp-seal" aria-hidden>{nada ? <AlertCircle size={38} /> : <Check size={38} />}</div>
      <h2 className="imp-result__title">{t(`shell.importClinic.result.${titulo}`)}</h2>
      <p className="imp-result__lead">
        {nada
          ? t("shell.importClinic.result.leadNothing", { count: errors })
          : parcial
            ? t("shell.importClinic.result.leadPartial", { count: errors, created })
            : t("shell.importClinic.result.leadOk")}
      </p>

      <div className="imp-summary-row">
        {/* Una pill por entidad importada, en el orden del paso 3. */}
        {DATA_TYPES.filter((d) => summary[d.entity] !== undefined).map((d) => (
          <div className="imp-summary-pill" key={d.entity}>
            <span className="imp-summary-pill__v mono">{(summary[d.entity] ?? 0).toLocaleString()}</span>
            <span className="imp-summary-pill__k">{t(`shell.importClinic.result.${PILL_KEY[d.entity]}`)}</span>
          </div>
        ))}
      </div>

      {errors > 0 && <ErroresDeImportacion t={t} filas={errorRows} total={errors} onDownload={onDownloadReport} />}

      {omitted > 0 && (
        <p className="imp-hint" style={{ textAlign: "center" }}>{t("shell.importClinic.result.omittedLine", { count: omitted })}</p>
      )}

      <div className="imp-result__ctas">
        <button type="button" className="btn-new btn-new--primary" onClick={onGoPatients}>
          <Users size={14} /> {t("shell.importClinic.result.goPatients")}
        </button>
        <button type="button" className="btn-new btn-new--secondary" onClick={onImportAnother}>
          <Upload size={14} /> {t("shell.importClinic.result.importAnother")}
        </button>
      </div>
    </div>
  );
}

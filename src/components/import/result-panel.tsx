"use client";

// Pantalla "Resultado" — resumen de éxito + descarga de reporte de errores + CTAs.
import { Check, AlertCircle, Download, Users, Upload } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { DATA_TYPES, type CommitResult, type Entity } from "./import-client";

/** Etiqueta de la pill de cada entidad (shell.importClinic.result.*). */
const PILL_KEY: Record<Entity, string> = {
  patients: "pillPatients",
  balances: "pillBalances",
  appointments: "pillAppointments",
  medicalHistory: "pillMedicalHistory",
  clinicalNotes: "pillClinicalNotes",
  quotes: "pillQuotes",
};

interface Props {
  t: TFunction;
  result: CommitResult;
  onGoPatients: () => void;
  onImportAnother: () => void;
  /** Descarga del reporte de errores. TODO(T4): URL real desde el commit. */
  onDownloadReport: () => void;
}

export function ResultPanel({ t, result, onGoPatients, onImportAnother, onDownloadReport }: Props) {
  const { created, errors, summary } = result;
  return (
    <div className="imp-result">
      <div className="imp-seal" aria-hidden><Check size={38} /></div>
      <h2 className="imp-result__title">{t("shell.importClinic.result.title")}</h2>
      <p className="imp-result__lead">{t("shell.importClinic.result.lead", { count: errors })}</p>

      <div className="imp-summary-row">
        {/* Una pill por entidad importada, en el orden del paso 3. */}
        {DATA_TYPES.filter((d) => summary[d.entity] !== undefined).map((d) => (
          <div className="imp-summary-pill" key={d.entity}>
            <span className="imp-summary-pill__v mono">{(summary[d.entity] ?? 0).toLocaleString()}</span>
            <span className="imp-summary-pill__k">{t(`shell.importClinic.result.${PILL_KEY[d.entity]}`)}</span>
          </div>
        ))}
      </div>

      {errors > 0 && (
        <div className="imp-report-line">
          <AlertCircle size={18} aria-hidden />
          <span>{t("shell.importClinic.result.reportLine", { count: errors })}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="imp-report-line__link" onClick={onDownloadReport}>
            <Download size={16} aria-hidden /> {t("shell.importClinic.result.downloadReport")}
          </button>
        </div>
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

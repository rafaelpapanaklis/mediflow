"use client";

// Pantalla "Resultado" — resumen de éxito + descarga de reporte de errores + CTAs.
import { Check, AlertCircle, Download, Users, Upload } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { CommitResult } from "./import-client";

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
        <div className="imp-summary-pill">
          <span className="imp-summary-pill__v mono">{summary.patients.toLocaleString()}</span>
          <span className="imp-summary-pill__k">{t("shell.importClinic.result.pillPatients")}</span>
        </div>
        <div className="imp-summary-pill">
          <span className="imp-summary-pill__v mono">{summary.balances}</span>
          <span className="imp-summary-pill__k">{t("shell.importClinic.result.pillBalances")}</span>
        </div>
        <div className="imp-summary-pill">
          <span className="imp-summary-pill__v mono">{summary.appointments.toLocaleString()}</span>
          <span className="imp-summary-pill__k">{t("shell.importClinic.result.pillAppointments")}</span>
        </div>
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

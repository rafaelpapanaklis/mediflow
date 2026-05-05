"use client";
// Endodontics — DiagnosisCard (sección 1, arriba). Spec §6.4

import { Activity, Plus, Stethoscope } from "lucide-react";
import type {
  EndodonticDiagnosisRow,
  VitalityTestRow,
} from "@/lib/types/endodontics";

const PULPAL_LABEL: Record<string, string> = {
  PULPA_NORMAL: "Pulpa normal",
  PULPITIS_REVERSIBLE: "Pulpitis reversible",
  PULPITIS_IRREVERSIBLE_SINTOMATICA: "Pulpitis irreversible sintomática",
  PULPITIS_IRREVERSIBLE_ASINTOMATICA: "Pulpitis irreversible asintomática",
  NECROSIS_PULPAR: "Necrosis pulpar",
  PREVIAMENTE_TRATADO: "Previamente tratado",
  PREVIAMENTE_INICIADO: "Previamente iniciado",
};

const PERIAPICAL_LABEL: Record<string, string> = {
  TEJIDOS_PERIAPICALES_NORMALES: "Tejidos periapicales normales",
  PERIODONTITIS_APICAL_SINTOMATICA: "Periodontitis apical sintomática",
  PERIODONTITIS_APICAL_ASINTOMATICA: "Periodontitis apical asintomática",
  ABSCESO_APICAL_AGUDO: "Absceso apical agudo",
  ABSCESO_APICAL_CRONICO: "Absceso apical crónico",
  OSTEITIS_CONDENSANTE: "Osteitis condensante",
};

const TEST_LABEL: Record<string, string> = {
  FRIO: "Frío",
  CALOR: "Calor",
  EPT: "EPT",
  PERCUSION_VERTICAL: "Percusión V",
  PERCUSION_HORIZONTAL: "Percusión H",
  PALPACION_APICAL: "Palpación",
  MORDIDA_TOOTHSLOOTH: "Mordida",
};

const RESULT_LABEL: Record<string, string> = {
  POSITIVO: "Positivo",
  NEGATIVO: "Negativo",
  EXAGERADO: "Exagerado",
  DIFERIDO: "Diferido",
  SIN_RESPUESTA: "Sin respuesta",
};

export interface DiagnosisCardProps {
  toothFdi: number;
  diagnosis: EndodonticDiagnosisRow | null;
  recentVitality: VitalityTestRow[];
  onCaptureDiagnosis: () => void;
  onCaptureVitality: () => void;
}

export function DiagnosisCard(props: DiagnosisCardProps) {
  const { toothFdi, diagnosis, recentVitality } = props;
  return (
    <section className="endo-section endo-diagnosis-card" aria-labelledby="endo-diag-title">
      <header className="endo-diagnosis-card__header">
        <div>
          <p className="endo-section__eyebrow">Diagnóstico · diente {toothFdi}</p>
          <h2 id="endo-diag-title" className="endo-section__title">
            {diagnosis
              ? PULPAL_LABEL[diagnosis.pulpalDiagnosis] ?? diagnosis.pulpalDiagnosis
              : "Sin diagnóstico"}
          </h2>
          {diagnosis ? (
            <p className="endo-section__sub">
              {PERIAPICAL_LABEL[diagnosis.periapicalDiagnosis] ?? diagnosis.periapicalDiagnosis}
            </p>
          ) : (
            <p className="endo-section__sub">
              Capturar diagnóstico AAE pulpar y periapical para empezar el plan endodóntico.
            </p>
          )}
        </div>
        <div className="endo-diagnosis-card__actions">
          <button
            type="button"
            className="pedi-btn"
            onClick={props.onCaptureVitality}
            aria-label="Registrar prueba de vitalidad"
          >
            <Activity size={14} aria-hidden /> Pruebas
          </button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={props.onCaptureDiagnosis}
          >
            {diagnosis ? (
              <><Stethoscope size={14} aria-hidden /> Reevaluar</>
            ) : (
              <><Plus size={14} aria-hidden /> Capturar diagnóstico</>
            )}
          </button>
        </div>
      </header>

      {diagnosis && (
        <dl className="endo-diagnosis-card__meta">
          <div>
            <dt>Última actualización</dt>
            <dd>{formatDate(diagnosis.diagnosedAt)}</dd>
          </div>
          <div>
            <dt>Justificación</dt>
            <dd>{diagnosis.justification ?? "—"}</dd>
          </div>
        </dl>
      )}

      {recentVitality.length > 0 && (
        <div className="endo-diagnosis-card__vitality">
          <h3>Pruebas recientes</h3>
          <table className="endo-table">
            <thead>
              <tr>
                <th>Prueba</th>
                <th>Diente</th>
                <th>Resultado</th>
                <th>Intensidad</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recentVitality.slice(0, 4).map((v) => (
                <tr key={v.id}>
                  <td>{TEST_LABEL[v.testType] ?? v.testType}</td>
                  <td className="endo-table__mono">{v.toothFdi}</td>
                  <td>
                    <span className={`endo-result-pill endo-result-pill--${v.result.toLowerCase()}`}>
                      {RESULT_LABEL[v.result] ?? v.result}
                    </span>
                  </td>
                  <td className="endo-table__mono">{v.intensity != null ? `${v.intensity}/10` : "—"}</td>
                  <td>{formatDate(v.evaluatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

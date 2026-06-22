"use client";

// Paso 5 · Mapear — empareja cada columna del archivo con un campo de DaleControl.
// Con perfil: columnas pre-resueltas (Automático). Sin perfil: manual, marcando
// en ámbar las columnas "Sin mapear".
import { Sparkles, AlertCircle, Check, X, ArrowRight } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { type Origin, type PreviewResult, type ColumnMapping } from "./import-client";

interface Props {
  t: TFunction;
  origin: Origin;
  preview: PreviewResult;
  mapping: ColumnMapping;
  /** El usuario eligió saldos/citas además de la entidad principal: esas columnas
   *  (Saldo, Tipo, Fecha de cita…) se autodetectan al importar, no se mapean aquí. */
  hasSecondary: boolean;
  onChange: (source: string, value: string) => void;
}

export function StepMapping({ t, origin, preview, mapping, hasSecondary, onChange }: Props) {
  const total = preview.columns.length;
  const matched = preview.columns.filter((c) => c.suggestion).length;
  // Banner "automático" siempre que el backend reconoció columnas (con o sin perfil);
  // solo "manual" puro cuando no reconoció ninguna.
  const showAuto = matched > 0;

  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.step5.title")}</h2>
      <p className="imp-sub">
        {showAuto
          ? t("shell.importClinic.step5.subAuto")
          : t("shell.importClinic.step5.subManual")}
      </p>

      {showAuto ? (
        <div className="imp-callout imp-callout--ok">
          <span className="imp-callout__ic" aria-hidden><Sparkles size={21} /></span>
          <div className="imp-callout__txt">
            <b>{t("shell.importClinic.step5.bannerAutoTitle")}</b>
            <p>{t("shell.importClinic.step5.bannerAutoDesc", { matched, total })}</p>
          </div>
        </div>
      ) : (
        <div className="imp-callout imp-callout--warn">
          <span className="imp-callout__ic" aria-hidden><AlertCircle size={21} /></span>
          <div className="imp-callout__txt">
            <b>{t("shell.importClinic.step5.bannerManualTitle")}</b>
            <p>{t("shell.importClinic.step5.bannerManualDesc", { name: origin.name })}</p>
          </div>
        </div>
      )}

      {hasSecondary && (
        <p className="imp-sub" style={{ marginTop: 10, color: "var(--text-3)", fontSize: 13 }}>
          {t("shell.importClinic.step5.autoDetectNote")}
        </p>
      )}

      <div className="table-wrap" style={{ marginTop: 14, border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="table-new" style={{ minWidth: 540 }}>
            <thead>
              <tr>
                <th>{t("shell.importClinic.step5.colYour")}</th>
                <th style={{ width: 40 }} aria-hidden />
                <th>{t("shell.importClinic.step5.colTarget")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.columns.map((col, i) => {
                const value = mapping[col.source] ?? "";
                const unmapped = value === "";
                const auto = !unmapped && value === col.suggestion;
                const selectId = `imp-map-${i}`;
                return (
                  <tr key={col.source}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{col.source}</div>
                      <div className="imp-sample">{t("shell.importClinic.step5.samplePrefix")} {col.sample}</div>
                    </td>
                    <td style={{ textAlign: "center", color: "var(--text-3)" }} aria-hidden>
                      <ArrowRight size={16} />
                    </td>
                    <td>
                      <label className="imp-visually-hidden" htmlFor={selectId}>
                        {t("shell.importClinic.step5.colTarget")} · {col.source}
                      </label>
                      <select
                        id={selectId}
                        className="input-new imp-select"
                        data-unmapped={unmapped ? "true" : "false"}
                        value={value}
                        onChange={(e) => onChange(col.source, e.target.value)}
                      >
                        {preview.targetFields.map((f) => (
                          <option key={f.value} value={f.value}>{f.labelKey ? t(f.labelKey) : f.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`imp-map-status ${auto ? "auto" : unmapped ? "skip" : "manual"}`}>
                        {auto ? <Sparkles size={14} /> : unmapped ? <X size={14} /> : <Check size={14} />}
                        {auto
                          ? t("shell.importClinic.step5.statusAuto")
                          : unmapped
                            ? t("shell.importClinic.step5.statusSkip")
                            : t("shell.importClinic.step5.statusManual")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

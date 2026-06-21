"use client";

// Paso 6 · Revisar — stat-cards (Válidos/Errores/Duplicados) + tabla con motivo
// de error en hover/foco + switch "Omitir duplicados".
import { Check, AlertCircle, Copy } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { PreviewResult, PreviewRow } from "./import-client";

function StatusBadge({ t, row }: { t: TFunction; row: PreviewRow }) {
  const badge =
    row.status === "ok" ? (
      <span className="badge-new badge-new--success"><span className="badge-new__dot" />{t("shell.importClinic.step6.badgeOk")}</span>
    ) : row.status === "error" ? (
      <span className="badge-new badge-new--danger">{t("shell.importClinic.step6.badgeError")}</span>
    ) : (
      <span className="badge-new badge-new--warning">{t("shell.importClinic.step6.badgeDuplicate")}</span>
    );

  if (!row.reason) return badge;
  return (
    <span className="imp-tip" tabIndex={0} title={row.reason}>
      {badge}
      <span className="imp-tip__bubble" role="tooltip">{row.reason}</span>
    </span>
  );
}

interface Props {
  t: TFunction;
  preview: PreviewResult;
  skipDup: boolean;
  onToggleSkip: () => void;
}

export function StepReview({ t, preview, skipDup, onToggleSkip }: Props) {
  const { stats, rows } = preview;
  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.step6.title")}</h2>
      <p className="imp-sub">{t("shell.importClinic.step6.sub")}</p>

      <div className="imp-stat-grid">
        <div className="imp-stat-card ok">
          <div className="imp-stat-card__top">
            <span className="imp-stat-card__ic" aria-hidden><Check size={17} /></span>
            <span className="imp-stat-card__lbl">{t("shell.importClinic.step6.statValid")}</span>
          </div>
          <div className="imp-stat-card__val mono">{stats.valid.toLocaleString()}</div>
        </div>
        <div className="imp-stat-card err">
          <div className="imp-stat-card__top">
            <span className="imp-stat-card__ic" aria-hidden><AlertCircle size={17} /></span>
            <span className="imp-stat-card__lbl">{t("shell.importClinic.step6.statErrors")}</span>
          </div>
          <div className="imp-stat-card__val mono">{stats.errors.toLocaleString()}</div>
        </div>
        <div className="imp-stat-card warn">
          <div className="imp-stat-card__top">
            <span className="imp-stat-card__ic" aria-hidden><Copy size={17} /></span>
            <span className="imp-stat-card__lbl">{t("shell.importClinic.step6.statDuplicates")}</span>
          </div>
          <div className="imp-stat-card__val mono">{stats.duplicates.toLocaleString()}</div>
        </div>
      </div>

      <div className="imp-review-toolbar">
        <button
          type="button"
          role="switch"
          aria-checked={skipDup}
          className={`switch${skipDup ? " switch--on" : ""}`}
          onClick={onToggleSkip}
          aria-label={t("shell.importClinic.step6.skipDup")}
        >
          <span className="switch__thumb" />
        </button>
        <span className="imp-switch-lbl">{t("shell.importClinic.step6.skipDup")}</span>
        <span className="imp-hint">{t("shell.importClinic.step6.hoverHint")}</span>
      </div>

      <div className="table-wrap" style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="table-new" style={{ minWidth: 540 }}>
            <thead>
              <tr>
                <th style={{ width: 56 }}>{t("shell.importClinic.step6.colRow")}</th>
                <th>{t("shell.importClinic.step6.colName")}</th>
                <th>{t("shell.importClinic.step6.colPhone")}</th>
                <th>{t("shell.importClinic.step6.colBalance")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={r.status === "error" ? "imp-row-err" : r.status === "duplicate" ? "imp-row-dup" : ""}>
                  <td className="mono">{r.row}</td>
                  <td>{r.name}</td>
                  <td className="mono">{r.phone}</td>
                  <td className="mono">
                    <span style={r.kind === "credit" ? { color: "var(--success)", fontWeight: 600 } : undefined}>
                      {r.balance}
                    </span>
                    {r.kind && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          color: r.kind === "credit" ? "var(--success)" : "var(--text-3)",
                        }}
                      >
                        {t(r.kind === "credit" ? "shell.importClinic.step6.kindCredit" : "shell.importClinic.step6.kindDebt")}
                      </span>
                    )}
                  </td>
                  <td><StatusBadge t={t} row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

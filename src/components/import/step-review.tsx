"use client";

// Paso 6 · Revisar — stat-cards (Válidos/Errores/Duplicados) + tabla con motivo
// de error en hover/foco + switch "Omitir duplicados". En presupuestos, además,
// los procedimientos que no casaron con el tarifario: cada uno entra «solo con
// su importe» salvo que aquí se elija su equivalente.
import { Check, AlertCircle, Copy, Link2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { CLINICAL_ENTITIES, VALUE_UNLINKED, type Entity, type PreviewResult, type PreviewRow } from "./import-client";

/** Entidades cuya tercera columna es el saldo; las demás enseñan un resumen de la fila. */
const WITH_BALANCE: ReadonlySet<Entity> = new Set<Entity>(["patients", "balances", "appointments"]);

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
  /** La entidad de esta vista previa (decide la tercera columna). */
  entity: Entity;
  preview: PreviewResult;
  skipDup: boolean;
  onToggleSkip: () => void;
  /** Equivalente elegido por procedimiento sin casar (clave → id o VALUE_UNLINKED). */
  decisions: Record<string, string>;
  onDecide: (key: string, id: string) => void;
}

/** Procedimientos que no están en el tarifario: uno por fila, con su selector. */
function Unresolved({ t, preview, decisions, onDecide }: Pick<Props, "t" | "preview" | "decisions" | "onDecide">) {
  const items = (preview.unresolved ?? []).filter((u) => u.field === "procedure");
  if (items.length === 0) return null;
  const options = preview.options?.procedure ?? [];
  return (
    <div className="imp-callout imp-callout--warn" style={{ marginTop: 14, alignItems: "flex-start" }}>
      <span className="imp-callout__ic" aria-hidden><Link2 size={21} /></span>
      <div className="imp-callout__txt" style={{ flex: 1, minWidth: 0 }}>
        <b>{t("shell.importClinic.step6.unresolvedTitle", { count: items.length })}</b>
        <p>{t("shell.importClinic.step6.unresolvedDesc")}</p>
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {items.map((u, i) => {
            const id = `imp-eq-${i}`;
            return (
              <li key={u.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <label htmlFor={id} style={{ flex: "1 1 180px", minWidth: 0, fontWeight: 500, overflowWrap: "anywhere" }}>
                  {u.value}{" "}
                  <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: 12 }}>
                    {t("shell.importClinic.step6.unresolvedRows", { count: u.rows })}
                  </span>
                </label>
                <select
                  id={id}
                  className="input-new imp-select"
                  style={{ flex: "1 1 220px", minWidth: 0, maxWidth: "100%" }}
                  value={decisions[u.key] ?? VALUE_UNLINKED}
                  onChange={(e) => onDecide(u.key, e.target.value)}
                >
                  <option value={VALUE_UNLINKED}>{t("shell.importClinic.step6.unresolvedUnlinked")}</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function StepReview({ t, entity, preview, skipDup, onToggleSkip, decisions, onDecide }: Props) {
  const { stats, rows } = preview;
  const withBalance = WITH_BALANCE.has(entity);
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
        {CLINICAL_ENTITIES.has(entity) ? (
          // Lo clínico nunca reimporta un duplicado: no hay interruptor que ofrecer.
          <span className="imp-switch-lbl">{t("shell.importClinic.step6.dupNever")}</span>
        ) : (
          <>
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
          </>
        )}
        <span className="imp-hint">{t("shell.importClinic.step6.hoverHint")}</span>
      </div>

      <Unresolved t={t} preview={preview} decisions={decisions} onDecide={onDecide} />

      <div className="table-wrap" style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="table-new" style={{ minWidth: 540 }}>
            <thead>
              <tr>
                <th style={{ width: 56 }}>{t("shell.importClinic.step6.colRow")}</th>
                <th>{t("shell.importClinic.step6.colName")}</th>
                <th>{t("shell.importClinic.step6.colPhone")}</th>
                <th>{t(withBalance ? "shell.importClinic.step6.colBalance" : "shell.importClinic.step6.colDetail")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={r.status === "error" ? "imp-row-err" : r.status === "duplicate" ? "imp-row-dup" : ""}>
                  <td className="mono">{r.row}</td>
                  <td>{r.name}</td>
                  <td className="mono">{r.phone}</td>
                  <td className={withBalance ? "mono" : undefined}>
                    <span style={r.kind === "credit" ? { color: "var(--success)", fontWeight: 600 } : undefined}>
                      {withBalance ? r.balance : (r.detail ?? "—")}
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

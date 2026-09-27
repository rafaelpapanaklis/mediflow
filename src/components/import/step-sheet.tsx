"use client";

// Paso 5 (antes del mapeo) · ¿Qué pestaña es de <pacientes/citas/saldos…>? — un .xlsx con
// varias hojas NUNCA se lee «por la primera»: se listan las pestañas con sus primeras
// filas, se propone la que se llama como los datos (si alguna) y el usuario confirma o
// cambia antes de seguir. Nada se importa hasta que confirma.
import { useState } from "react";
import { Layers, Check } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { Entity, SheetInfo } from "./import-client";

interface Props {
  t: TFunction;
  entity: Entity;
  sheets: SheetInfo[];
  /** La que propone el nombre (o null). */
  suggested: string | null;
  /** La ya confirmada, si se está cambiando (preselecciona esa). */
  current: string | null;
  onConfirm: (name: string) => void;
}

export function StepSheet({ t, entity, sheets, suggested, current, onConfirm }: Props) {
  // Preselecciona la actual, o la propuesta; si no hay ninguna, nada: el usuario tiene que elegir.
  const [picked, setPicked] = useState<string | null>(current ?? suggested ?? null);
  const info = sheets.find((s) => s.name === picked) ?? null;
  const entityName = t(`shell.importClinic.importing.ent.${entity}`).toLowerCase();

  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.sheet.title", { entity: entityName })}</h2>
      <p className="imp-sub">{t("shell.importClinic.sheet.sub", { count: sheets.length })}</p>
      {!suggested && !current && (
        <div className="imp-callout imp-callout--warn" role="note" style={{ marginBottom: 12 }}>
          <span className="imp-callout__ic" aria-hidden><Layers size={21} /></span>
          <div className="imp-callout__txt"><p>{t("shell.importClinic.sheet.none", { entity: entityName })}</p></div>
        </div>
      )}

      <div role="radiogroup" aria-label={t("shell.importClinic.sheet.title", { entity: entityName })} className="imp-opt-list">
        {sheets.map((s, i) => {
          const on = s.name === picked;
          const id = `imp-sheet-${i}`;
          return (
            <label key={s.name} htmlFor={id} className={`imp-opt${on ? " is-on" : ""}`}>
              <span className="imp-opt__box" aria-hidden><Check size={14} /></span>
              <span className="imp-opt__ic" aria-hidden><Layers size={20} /></span>
              <span className="imp-opt__info">
                <span className="imp-opt__nm">
                  {s.name}{" "}
                  {s.name === suggested && <span className="badge-new badge-new--brand">{t("shell.importClinic.sheet.suggested")}</span>}
                </span>
                <span className="imp-opt__meta">
                  {s.rows > 0 ? t("shell.importClinic.sheet.rows", { count: s.rows }) : t("shell.importClinic.sheet.empty")}
                  {s.columns.length > 0 ? ` · ${s.columns.slice(0, 6).join(", ")}${s.columns.length > 6 ? "…" : ""}` : ""}
                </span>
              </span>
              <input id={id} type="radio" name="imp-sheet" checked={on} onChange={() => setPicked(s.name)} />
            </label>
          );
        })}
      </div>

      {info && info.columns.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="imp-hint" style={{ margin: "0 0 6px" }}>{t("shell.importClinic.sheet.previewOf", { name: info.name })}</p>
          <div className="table-wrap" style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table-new" style={{ minWidth: 480 }}>
                <thead>
                  <tr>{info.columns.map((c, i) => <th key={`${c}-${i}`}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {info.sample.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => <td key={c}>{cell || "—"}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn-new btn-new--primary" disabled={!info || info.rows === 0} onClick={() => info && onConfirm(info.name)}>
          {t("shell.importClinic.sheet.use")}
        </button>
      </div>
    </div>
  );
}

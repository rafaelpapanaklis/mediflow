"use client";

import { Eye } from "lucide-react";

interface VisualAcuityValues {
  odSC?: string;
  odCC?: string;
  oiSC?: string;
  oiCC?: string;
}

interface VisualAcuityProps {
  values: VisualAcuityValues;
  onChange?: (values: VisualAcuityValues) => void;
  editable?: boolean;
}

const SNELLEN_OPTIONS = [
  "20/20",
  "20/25",
  "20/30",
  "20/40",
  "20/60",
  "20/80",
  "20/100",
  "20/200",
  "CD",
  "MM",
  "PL",
  "NPL",
];

export function VisualAcuityTable({ values, onChange, editable }: VisualAcuityProps) {
  function update(key: keyof VisualAcuityValues, v: string) {
    if (!onChange) return;
    onChange({ ...values, [key]: v || undefined });
  }

  const cellStyle: React.CSSProperties = {
    padding: 10,
    border: "1px solid var(--border)",
    textAlign: "center",
    minWidth: 120,
  };
  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    background: "rgba(124,58,237,0.08)",
    color: "var(--text-2)",
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: 600,
  };

  function renderCell(key: keyof VisualAcuityValues) {
    const v = values[key] ?? "";
    if (!editable) {
      return (
        <td style={cellStyle}>
          <span style={{ color: "var(--text-1)", fontSize: 14, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
            {v || "—"}
          </span>
        </td>
      );
    }
    return (
      <td style={cellStyle}>
        <select
          className="input-new"
          value={v}
          onChange={(e) => update(key, e.target.value)}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace", textAlign: "center" }}
        >
          <option value="">—</option>
          {SNELLEN_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </td>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Eye size={18} color="var(--brand)" />
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Agudeza visual</div>
          <div style={{ fontSize: 11, color: "var(--text-2)" }}>Notación Snellen</div>
        </div>
      </div>

      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}></th>
              <th style={headerStyle}>SC (sin corrección)</th>
              <th style={headerStyle}>CC (con corrección)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={headerStyle}>OD</td>
              {renderCell("odSC")}
              {renderCell("odCC")}
            </tr>
            <tr>
              <td style={headerStyle}>OI</td>
              {renderCell("oiSC")}
              {renderCell("oiCC")}
            </tr>
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 10,
          color: "var(--text-2)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span><strong style={{ color: "var(--text-1)" }}>CD</strong> = Cuenta Dedos</span>
        <span><strong style={{ color: "var(--text-1)" }}>MM</strong> = Movimiento de Manos</span>
        <span><strong style={{ color: "var(--text-1)" }}>PL</strong> = Percepción de Luz</span>
        <span><strong style={{ color: "var(--text-1)" }}>NPL</strong> = No Percepción de Luz</span>
      </div>
    </div>
  );
}

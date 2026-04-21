"use client";

import { useRef } from "react";
import { Glasses, Printer } from "lucide-react";

interface OpticalRx {
  od: { esf?: number; cil?: number; eje?: number; add?: number };
  oi: { esf?: number; cil?: number; eje?: number; add?: number };
  dp?: number;
  notes?: string;
}

interface OpticalPrescriptionProps {
  rx: OpticalRx;
  onChange?: (rx: OpticalRx) => void;
  editable?: boolean;
  patientName?: string;
  onExportPDF?: () => void;
}

type Eye = "od" | "oi";
type Field = "esf" | "cil" | "eje" | "add";

export function OpticalPrescription({
  rx,
  onChange,
  editable,
  patientName,
  onExportPDF,
}: OpticalPrescriptionProps) {
  const printRef = useRef<HTMLDivElement>(null);

  function updateEye(eye: Eye, field: Field, value: string) {
    if (!onChange) return;
    const num = value === "" ? undefined : Number(value);
    onChange({
      ...rx,
      [eye]: { ...rx[eye], [field]: Number.isNaN(num) ? undefined : num },
    });
  }

  function updateDP(v: string) {
    if (!onChange) return;
    const num = v === "" ? undefined : Number(v);
    onChange({ ...rx, dp: Number.isNaN(num) ? undefined : num });
  }

  function updateNotes(v: string) {
    if (!onChange) return;
    onChange({ ...rx, notes: v || undefined });
  }

  function handleExport() {
    if (onExportPDF) {
      onExportPDF();
      return;
    }
    const content = printRef.current?.innerHTML ?? "";
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`
      <html>
        <head>
          <title>Receta óptica${patientName ? ` · ${patientName}` : ""}</title>
          <style>
            body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
            table { border-collapse: collapse; width: 100%; margin-top: 16px; }
            th, td { border: 1px solid #333; padding: 8px; text-align: center; }
            th { background: #eee; }
            h1 { font-size: 18px; }
            .muted { color: #555; font-size: 12px; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    w.document.close();
    w.focus();
    w.print();
  }

  const cellStyle: React.CSSProperties = {
    padding: 8,
    border: "1px solid var(--border)",
    textAlign: "center",
    minWidth: 90,
  };
  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    background: "rgba(124,58,237,0.08)",
    color: "var(--text-2)",
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: 600,
  };

  function renderCell(eye: Eye, field: Field, step: number) {
    const val = rx[eye][field];
    if (!editable) {
      return (
        <td style={cellStyle}>
          <span style={{ color: "var(--text-1)", fontFamily: "ui-monospace, monospace" }}>
            {val !== undefined ? val : "—"}
          </span>
        </td>
      );
    }
    return (
      <td style={cellStyle}>
        <input
          type="number"
          step={step}
          className="input-new"
          value={val ?? ""}
          onChange={(e) => updateEye(eye, field, e.target.value)}
          style={{ width: "100%", textAlign: "center", fontFamily: "ui-monospace, monospace" }}
        />
      </td>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Glasses size={18} color="var(--brand)" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
              Receta óptica
            </div>
            {patientName && (
              <div style={{ fontSize: 11, color: "var(--text-2)" }}>{patientName}</div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="btn-new btn-new--primary"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Printer size={14} /> Exportar PDF
        </button>
      </div>

      <div ref={printRef}>
        {patientName && (
          <h1 style={{ color: "var(--text-1)", fontSize: 14, marginBottom: 8 }}>
            Paciente: {patientName}
          </h1>
        )}

        <div style={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={headerStyle}></th>
                <th style={headerStyle}>ESF</th>
                <th style={headerStyle}>CIL</th>
                <th style={headerStyle}>EJE</th>
                <th style={headerStyle}>ADD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={headerStyle}>OD</td>
                {renderCell("od", "esf", 0.25)}
                {renderCell("od", "cil", 0.25)}
                {renderCell("od", "eje", 1)}
                {renderCell("od", "add", 0.25)}
              </tr>
              <tr>
                <td style={headerStyle}>OI</td>
                {renderCell("oi", "esf", 0.25)}
                {renderCell("oi", "cil", 0.25)}
                {renderCell("oi", "eje", 1)}
                {renderCell("oi", "add", 0.25)}
              </tr>
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", fontWeight: 600 }}>
              DP (mm)
            </span>
            {editable ? (
              <input
                type="number"
                step={0.5}
                className="input-new"
                value={rx.dp ?? ""}
                onChange={(e) => updateDP(e.target.value)}
                style={{ width: 90, textAlign: "center", fontFamily: "ui-monospace, monospace" }}
              />
            ) : (
              <span style={{ color: "var(--text-1)", fontFamily: "ui-monospace, monospace" }}>
                {rx.dp ?? "—"}
              </span>
            )}
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", fontWeight: 600 }}>
            Notas
          </label>
          {editable ? (
            <textarea
              className="input-new"
              rows={3}
              value={rx.notes ?? ""}
              onChange={(e) => updateNotes(e.target.value)}
              style={{ width: "100%", resize: "vertical", marginTop: 4 }}
              placeholder="Instrucciones, tipo de lente, próximo control..."
            />
          ) : (
            <div style={{ color: "var(--text-1)", fontSize: 13, marginTop: 4 }}>
              {rx.notes || "—"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

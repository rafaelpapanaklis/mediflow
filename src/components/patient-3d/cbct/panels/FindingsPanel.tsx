"use client";

// STUB del panel de hallazgos (lista de anotaciones). Muestra la lista mínima
// para verificar el flujo de selección. TODO(T6): valor por tipo (mm/°), editar
// etiqueta (onRename), borrar (onRemove), tiradores de implante (onEditImplant),
// usando TOOL_COLORS y mmPorPixel.

import type { FindingsPanelProps } from "../types";
import { TOOL_COLORS } from "../constants";

const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#aeb9cc", margin: "0 0 6px" };
const stubStyle: React.CSSProperties = { fontSize: 11, color: "#6f7c92", margin: 0 };

export function FindingsPanel({ annos, selectedId, onSelect }: FindingsPanelProps) {
  return (
    <section className="vc-panel" style={{ padding: 12, borderBottom: "1px solid #161d27" }}>
      <h3 className="vc-panel-title" style={titleStyle}>Hallazgos</h3>
      {annos.length === 0 ? (
        <p className="vc-panel-stub" style={stubStyle}>Sin mediciones ni marcas — pendiente (T6)</p>
      ) : (
        <ul className="vc-findings-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {annos.map((a) => (
            <li
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={selectedId === a.id ? "on" : ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                color: "#c2ccdb",
                background: selectedId === a.id ? "var(--accent-soft, rgba(42,111,219,.17))" : "transparent",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: TOOL_COLORS[a.type], flex: "0 0 auto" }} />
              <span style={{ textTransform: "capitalize" }}>{a.type}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#6f7c92" }}>{a.plane}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default FindingsPanel;

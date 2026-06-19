"use client";

// Rail de herramientas. Funcional en la fundación (cambia `tool`); T5/T6 añaden
// estilo definitivo y estados. TODO(T5): captura por herramienta vive en Stage.

import type { ToolbarProps } from "../types";
import { TOOLS } from "../constants";
import { IcUndo, IcTrash, IcDownload } from "../icons";

export function Toolbar({ tool, setTool, orientation = "v", onUndo, canUndo, onClear, onShot }: ToolbarProps) {
  const wrap: React.CSSProperties = {
    display: "flex",
    flexDirection: orientation === "v" ? "column" : "row",
    gap: 4,
    padding: 6,
  };
  const btn = (on: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    minHeight: 44,
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    color: on ? "#fff" : "#9aa7bd",
    background: on ? "var(--accent, #2a6fdb)" : "transparent",
    fontSize: 12,
    fontWeight: 600,
  });
  return (
    <div className={"vc-toolbar vc-toolbar-" + orientation} style={wrap}>
      {TOOLS.map((t) => (
        <button key={t.id} type="button" title={t.label} className={"vc-tool" + (tool === t.id ? " on" : "")} style={btn(tool === t.id)} onClick={() => setTool(t.id)}>
          <t.Icon />
          <span className="vc-tool-label">{t.label}</span>
        </button>
      ))}
      <div className="vc-toolbar-sep" style={{ height: 1, background: "#1e2733", margin: "4px 0" }} />
      <button type="button" className="vc-tool" title="Deshacer" style={btn(false)} disabled={!canUndo} onClick={onUndo}>
        <IcUndo />
      </button>
      <button type="button" className="vc-tool" title="Borrar todo" style={btn(false)} onClick={onClear}>
        <IcTrash />
      </button>
      <button type="button" className="vc-tool" title="Captura" style={btn(false)} onClick={onShot}>
        <IcDownload />
      </button>
    </div>
  );
}

export default Toolbar;

"use client";

// Rail de herramientas (T5). Selección de herramienta + deshacer/captura/limpiar.
// La CAPTURA de puntos por herramienta vive en Stage; aquí solo se elige `tool`.
// Controles ≥48px (táctil). El color del tipo de anotación tiñe la herramienta
// activa para reforzar la correspondencia con el overlay. El estilo fino global
// (clases vc-*) lo trae T6; aquí van estilos inline mínimos para ser funcional.

import type { ToolbarProps } from "../types";
import { TOOLS, TOOL_COLORS } from "../constants";
import { IcUndo, IcTrash, IcCamera } from "../icons";

export function Toolbar({ tool, setTool, orientation = "v", onUndo, canUndo, onClear, onShot }: ToolbarProps) {
  const vertical = orientation === "v";
  const wrap: React.CSSProperties = {
    display: "flex",
    flexDirection: vertical ? "column" : "row",
    alignItems: "stretch",
    gap: 4,
    padding: 6,
  };
  const btn = (on: boolean, tone?: string, danger?: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: vertical ? "flex-start" : "center",
    gap: 9,
    padding: vertical ? "0 12px" : "0 10px",
    minHeight: 48,
    minWidth: 48,
    borderRadius: 10,
    border: "1px solid " + (on ? tone || "var(--accent,#2a6fdb)" : "transparent"),
    cursor: "pointer",
    color: on ? "#fff" : danger ? "#e98a98" : "#9aa7bd",
    background: on ? (tone ? tone + "22" : "var(--accent,#2a6fdb)") : "transparent",
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    transition: "background .12s, border-color .12s, color .12s",
  });
  return (
    <div
      className={"vc-toolbar vc-toolbar-" + orientation}
      style={wrap}
      role="toolbar"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label="Herramientas del visor"
    >
      {TOOLS.map((t) => {
        const on = tool === t.id;
        const tone = (TOOL_COLORS as Record<string, string>)[t.id];
        return (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-pressed={on}
            className={"vc-tool" + (on ? " on" : "")}
            style={btn(on, on ? tone : undefined)}
            onClick={() => setTool(t.id)}
          >
            <t.Icon />
            <span className="vc-tool-label">{t.label}</span>
          </button>
        );
      })}

      <div
        className="vc-toolbar-sep"
        style={{ flex: "0 0 auto", background: "#1e2733", height: vertical ? 1 : 26, width: vertical ? "auto" : 1, margin: vertical ? "4px 6px" : "0 4px" }}
      />

      <button
        type="button"
        className="vc-tool"
        title="Deshacer última anotación"
        aria-label="Deshacer"
        disabled={!canUndo}
        style={{ ...btn(false), opacity: canUndo ? 1 : 0.4, cursor: canUndo ? "pointer" : "not-allowed" }}
        onClick={onUndo}
      >
        <IcUndo />
        <span className="vc-tool-label">Deshacer</span>
      </button>
      <button type="button" className="vc-tool" title="Captura del estudio" aria-label="Captura" style={btn(false)} onClick={onShot}>
        <IcCamera />
        <span className="vc-tool-label">Captura</span>
      </button>
      <button type="button" className="vc-tool danger" title="Borrar todas las anotaciones" aria-label="Limpiar" style={btn(false, undefined, true)} onClick={onClear}>
        <IcTrash />
        <span className="vc-tool-label">Limpiar</span>
      </button>
    </div>
  );
}

export default Toolbar;

"use client";

// Panel de notas del estudio (FIX1): LISTA de notas independientes — agregar,
// editar en vivo y borrar varias. La persistencia es AUTOMÁTICA (FIX2): cada
// cambio dispara el autosave de CbctViewer → onGuardarNota (doctorNotes). El
// indicador del título muestra "sin guardar" (cambios pendientes) o "✓ guardado".

import { useState } from "react";
import type { CSSProperties } from "react";
import type { NotesPanelProps } from "../types";
import { IcCheck, IcTrash, IcNote } from "../icons";
import "../cbct.css";

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  marginBottom: 8,
};
const itemTaStyle: CSSProperties = {
  flex: 1,
  minHeight: 46,
  resize: "vertical",
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid #1e2733",
  background: "#0a0e14",
  color: "#dbe3ee",
  fontSize: 12.5,
  lineHeight: 1.4,
  fontFamily: "inherit",
};
const delStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid #1e2733",
  background: "transparent",
  color: "#8a97ad",
  cursor: "pointer",
};

export function NotesPanel({ notes, onAdd, onEdit, onRemove, dirty, saved }: NotesPanelProps) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  };
  const canAdd = draft.trim().length > 0;

  return (
    <div className="vc-section">
      <div className="vc-sec-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Notas del estudio</span>
        {dirty ? (
          <span className="vc-hu" style={{ color: "#f59e0b" }}>sin guardar</span>
        ) : saved ? (
          <span className="vc-hu" style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <IcCheck /> guardado
          </span>
        ) : null}
      </div>

      {notes.length === 0 ? (
        <div style={{ fontSize: 12, color: "#6f7c92", padding: "4px 0 10px" }}>
          Sin notas todavía. Agrega la primera abajo.
        </div>
      ) : (
        <div role="list" style={{ marginBottom: 6 }}>
          {notes.map((n) => (
            <div role="listitem" key={n.id} style={itemStyle}>
              <textarea
                style={itemTaStyle}
                value={n.texto}
                aria-label="Nota del estudio"
                onChange={(e) => onEdit(n.id, e.target.value)}
              />
              <button
                type="button"
                style={delStyle}
                title="Eliminar nota"
                aria-label="Eliminar nota"
                onClick={() => onRemove(n.id)}
              >
                <IcTrash />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        className="vc-notes"
        placeholder="Escribe una nota nueva… (Ctrl/⌘+Enter para agregar)"
        value={draft}
        aria-label="Nueva nota del estudio"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <button
        type="button"
        className="vc-save"
        onClick={add}
        disabled={!canAdd}
        style={!canAdd ? { opacity: 0.5, cursor: "default" } : undefined}
      >
        <IcNote /> Agregar nota
      </button>
    </div>
  );
}

export default NotesPanel;

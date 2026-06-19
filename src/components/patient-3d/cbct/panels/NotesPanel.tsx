"use client";

// STUB del panel de notas del estudio. Funcional mínimo (textarea + guardar);
// T6 pule el estilo/estados. La persistencia real la conecta CbctViewer →
// onGuardarNota (T7 contra PatientFile.doctorNotes).

import type { NotesPanelProps } from "../types";

const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#aeb9cc", margin: "0 0 6px" };

export function NotesPanel({ notes, setNotes, onSave, saved }: NotesPanelProps) {
  return (
    <section className="vc-panel" style={{ padding: 12 }}>
      <h3 className="vc-panel-title" style={titleStyle}>Notas del estudio</h3>
      <textarea
        className="vc-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Escribe la nota del estudio…"
        rows={4}
        style={{
          width: "100%",
          resize: "vertical",
          background: "#0e141d",
          border: "1px solid #1e2733",
          borderRadius: 8,
          color: "#dbe3ee",
          fontSize: 12,
          padding: 8,
          fontFamily: "inherit",
        }}
      />
      <button
        type="button"
        className="vc-notes-save"
        onClick={onSave}
        style={{
          marginTop: 8,
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          background: saved ? "#1f8a5b" : "var(--accent, #2a6fdb)",
        }}
      >
        {saved ? "Guardado ✓" : "Guardar nota"}
      </button>
    </section>
  );
}

export default NotesPanel;

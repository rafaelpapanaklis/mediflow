"use client";

// Panel de notas del estudio: textarea + botón Guardar con estado `saved`
// (✓ Guardado). La persistencia real la hace CbctViewer → onGuardarNota (T7
// contra PatientFile.doctorNotes). Estilo en cbct.css.

import type { NotesPanelProps } from "../types";
import { IcCheck, IcDownload } from "../icons";
import "../cbct.css";

export function NotesPanel({ notes, setNotes, onSave, saved }: NotesPanelProps) {
  return (
    <div className="vc-section">
      <div className="vc-sec-title">Notas del estudio</div>
      <textarea
        className="vc-notes"
        placeholder="Hallazgos clínicos, plan de tratamiento, observaciones sobre este CBCT…"
        value={notes}
        aria-label="Notas del estudio"
        onChange={(e) => setNotes(e.target.value)}
      />
      <button type="button" className={"vc-save" + (saved ? " done" : "")} onClick={onSave}>
        {saved ? <IcCheck /> : <IcDownload />}
        {saved ? "Guardado" : "Guardar notas"}
      </button>
    </div>
  );
}

export default NotesPanel;

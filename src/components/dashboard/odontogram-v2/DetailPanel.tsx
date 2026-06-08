"use client";

import { useState, useEffect } from "react";
import { classify, numberLabel, GROUP_COLOR, COND_BY_ID, I18N } from "./data";
import type { DetailPanelProps } from "./types";
import { Surface2D } from "./Surface2D";
import { PalmerLabel } from "./Odontogram";

const TYPE_NAMES: Record<string, Record<"es" | "en", string>> = {
  central: { es: "Incisivo central", en: "Central incisor" },
  lateral: { es: "Incisivo lateral", en: "Lateral incisor" },
  canine: { es: "Canino", en: "Canine" },
  premolar: { es: "Premolar", en: "Premolar" },
  molar: { es: "Molar", en: "Molar" },
};

/**
 * DetailPanel — slide-over for the selected tooth.
 * STUB: 2D view (stub) + findings list (remove) + notes + clear/close, all wired.
 * WS3-T5/T6 fill the 3D/2D toggle, surface grid and mini-palette per design
 * jsx/detail.jsx. brush/eraser/onPick are part of the contract for that work.
 */
export function DetailPanel({ fdi, lang, numbering, record, onApply, onClose, onClearTooth, onNote, onRemove }: DetailPanelProps) {
  const t = I18N[lang];
  const meta = classify(fdi);
  const num = numberLabel(fdi, numbering);
  const [note, setNoteLocal] = useState(record.note || "");
  useEffect(() => { setNoteLocal(record.note || ""); }, [fdi, record.note]);

  const typeName = TYPE_NAMES[meta.type][lang] + (meta.primary ? (lang === "es" ? " (temporal)" : " (primary)") : "");
  const applyFace = (letter: string) => onApply(fdi, "surface", letter);

  const findings: { scope: "tooth" | "surface"; letter?: string; id: string }[] = [];
  (record.tooth || []).forEach((id) => findings.push({ scope: "tooth", id }));
  Object.entries(record.surfaces || {}).forEach(([letter, arr]) =>
    (arr as string[]).forEach((id) => findings.push({ scope: "surface", letter, id })));

  return (
    <div className="odo-detail-backdrop" onClick={onClose}>
      <aside className="odo-detail" onClick={(e) => e.stopPropagation()} data-odo-stub="detail-panel">
        <div className="odo-dt-head">
          <div className="odo-dt-tooth">
            <span className="odo-dt-num">
              {numbering === "palmer" ? <PalmerLabel quad={num.quad} label={num.label} /> : num.label}
            </span>
            <div>
              <div className="odo-dt-type">{typeName}</div>
              <div className="odo-dt-type" style={{ fontWeight: 700 }}>{meta.upper ? t.upperArch : t.lowerArch}</div>
            </div>
          </div>
          <button className="odo-dt-close" onClick={onClose}>×</button>
        </div>

        <div className="odo-dt-body">
          <div className="odo-2d-stage">
            <Surface2D meta={meta} record={record} size={170} onSurface={applyFace} />
          </div>

          <div className="odo-section-t">{t.history}</div>
          <div className="odo-find-list">
            {findings.length === 0 && <div className="odo-empty">{t.noFindings}</div>}
            {findings.map((f, i) => {
              const cond = COND_BY_ID[f.id];
              return (
                <div className="odo-find" key={i}>
                  <span className="odo-find-dot" style={{ background: cond ? GROUP_COLOR[cond.group] : "#ccc" }} />
                  <span className="odo-find-lb">{cond ? cond[lang] : f.id}</span>
                  <span className="odo-find-loc">{f.scope === "surface" ? f.letter : (lang === "es" ? "diente" : "tooth")}</span>
                  <button className="odo-find-rm" onClick={() => onRemove(fdi, f.scope, f.letter, f.id)}>×</button>
                </div>
              );
            })}
          </div>

          <div className="odo-section-t">{t.notes}</div>
          <textarea
            className="odo-note"
            placeholder={t.notesPh}
            value={note}
            onChange={(e) => setNoteLocal(e.target.value)}
            onBlur={() => onNote(note)}
          />

          <div className="odo-dt-actions">
            <button className="odo-btn danger" onClick={onClearTooth}>{t.clear} {t.tooth.toLowerCase()}</button>
            <button className="odo-btn" onClick={onClose}>{t.close}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

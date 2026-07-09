"use client";

import { useState, useEffect } from "react";
import {
  classify, numberLabel, GROUP_COLOR, COND_BY_ID, I18N,
  SURFACES, SURFACE_NAMES, GROUPS, CONDITIONS,
} from "./data";
import type { DetailPanelProps, Lang } from "./types";
import { Surface2D } from "./Surface2D";
import { Tooth3D } from "./Tooth3D";
import { PalmerLabel } from "./Odontogram";
import { ConditionSwatch } from "./Palette";

const TYPE_NAMES: Record<string, Record<"es" | "en", string>> = {
  central: { es: "Incisivo central", en: "Central incisor" },
  lateral: { es: "Incisivo lateral", en: "Lateral incisor" },
  canine: { es: "Canino", en: "Canine" },
  premolar: { es: "Premolar", en: "Premolar" },
  molar: { es: "Molar", en: "Molar" },
};

/**
 * DetailPanel — slide-over for the selected tooth. Ported 1:1 from design
 * jsx/detail.jsx: 3D/2D view toggle, surface grid, mini palette
 * (DetailPalette), recorded findings (with remove), clinical notes and
 * clear/close actions. Drives state through the contract callbacks
 * onApply / onRemove / onNote / onPick / onClose (DetailPanelProps).
 */
export function DetailPanel({
  fdi, lang, numbering, record, brush,
  onApply, onClose, onClearTooth, onNote, onRemove, onPick,
}: DetailPanelProps) {
  const t = I18N[lang];
  const meta = classify(fdi);
  const num = numberLabel(fdi, numbering);
  // Default 2D en dispositivos táctiles (teléfono/tablet), 3D en escritorio con
  // mouse. El usuario puede cambiar con el toggle 3D/2D; esto solo fija el inicio.
  const [view, setView] = useState<"3d" | "2d">(() => {
    if (typeof window === "undefined") return "3d";
    return window.matchMedia("(pointer: coarse)").matches ? "2d" : "3d";
  });
  const [resetKey, setResetKey] = useState(0);
  const [note, setNoteLocal] = useState(record.note || "");

  // Re-sync the textarea when the tooth changes or the note is updated/cleared
  // externally (e.g. "clear tooth"). Local edits survive surface/finding edits.
  useEffect(() => { setNoteLocal(record.note || ""); }, [fdi, record.note]);

  const typeName =
    TYPE_NAMES[meta.type][lang] + (meta.primary ? (lang === "es" ? " (temporal)" : " (primary)") : "");
  const surfaceLetters = meta.posterior ? SURFACES.posterior : SURFACES.anterior;

  // Color of a surface button = group color of its last (top-most) finding.
  const surfaceColor = (letter: string): string | null => {
    const arr = (record.surfaces || {})[letter];
    if (!arr || !arr.length) return null;
    const cond = COND_BY_ID[arr[arr.length - 1]];
    return cond ? GROUP_COLOR[cond.group] : null;
  };

  // Assemble the findings list: whole-tooth conditions first, then per-surface.
  const findings: { scope: "tooth" | "surface"; letter?: string; id: string }[] = [];
  (record.tooth || []).forEach((id) => findings.push({ scope: "tooth", id }));
  Object.entries(record.surfaces || {}).forEach(([letter, arr]) =>
    (arr as string[]).forEach((id) => findings.push({ scope: "surface", letter, id })));

  const applyFace = (letter: string) => onApply(fdi, "surface", letter);

  return (
    <div className="odo-detail-backdrop" onClick={onClose}>
      <aside className="odo-detail" onClick={(e) => e.stopPropagation()}>
        <div className="odo-dt-head">
          <div className="odo-dt-tooth">
            <span className="odo-dt-num">
              {numbering === "palmer" ? <PalmerLabel quad={num.quad} label={num.label} /> : num.label}
            </span>
            <div>
              <div className="odo-dt-type">{typeName}</div>
              <div className="odo-dt-type" style={{ color: "var(--ink-2)", fontWeight: 700 }}>
                {(meta.upper ? t.upperArch : t.lowerArch) + " · " +
                  (meta.side === "right"
                    ? (lang === "es" ? "derecha" : "right")
                    : (lang === "es" ? "izquierda" : "left"))}
              </div>
            </div>
          </div>
          <button type="button" className="odo-dt-close" onClick={onClose}>×</button>
        </div>

        <div className="odo-dt-body">
          {/* view toggle */}
          <div className="odo-viewtabs">
            <button type="button" className={"odo-viewtab" + (view === "3d" ? " on" : "")} onClick={() => setView("3d")}>{t.view3d}</button>
            <button type="button" className={"odo-viewtab" + (view === "2d" ? " on" : "")} onClick={() => setView("2d")}>{t.view2d}</button>
          </div>

          {view === "3d" ? (
            <div className="odo-3d-stage">
              <button type="button" className="odo-3d-reset" onClick={() => setResetKey((k) => k + 1)}>{t.resetView}</button>
              <Tooth3D
                meta={meta}
                record={record}
                onSurface={applyFace}
                style={typeof document !== "undefined" && document.querySelector(".odo-app")?.className.includes("mono") ? "mono" : "light"}
                resetKey={resetKey}
              />
              <div className="odo-3d-hint">{t.rotate}</div>
            </div>
          ) : (
            <div className="odo-2d-stage">
              <Surface2D meta={meta} record={record} size={170} onSurface={applyFace} />
            </div>
          )}

          {/* surfaces */}
          <div className="odo-section-t">{t.surfaces}</div>
          <div className="odo-surf-grid">
            {surfaceLetters.map((letter) => {
              const col = surfaceColor(letter);
              return (
                <button type="button"
                  key={letter}
                  className={"odo-surf-btn" + (col ? " has" : "")}
                  style={col ? { background: col } : {}}
                  onClick={() => applyFace(letter)}
                >
                  {letter}
                  <small style={col ? { color: "rgba(255,255,255,.85)" } : {}}>
                    {SURFACE_NAMES[letter][lang].split(" /")[0]}
                  </small>
                </button>
              );
            })}
          </div>

          {/* mini palette */}
          <div className="odo-section-t">{t.brush}</div>
          <DetailPalette lang={lang} brush={brush} onPick={onPick} />

          {/* findings */}
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
                  <button type="button" className="odo-find-rm" onClick={() => onRemove(fdi, f.scope, f.letter, f.id)}>×</button>
                </div>
              );
            })}
          </div>

          {/* notes */}
          <div className="odo-section-t">{t.notes}</div>
          <textarea
            className="odo-note"
            placeholder={t.notesPh}
            value={note}
            onChange={(e) => setNoteLocal(e.target.value)}
            onBlur={() => onNote(note)}
          />

          <div className="odo-dt-actions">
            <button type="button" className="odo-btn danger" onClick={onClearTooth}>{t.clear} {t.tooth.toLowerCase()}</button>
            <button type="button" className="odo-btn" onClick={onClose}>{t.close}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * DetailPalette — compact specialty tabs + finding chips inside the panel.
 * Ported 1:1 from design jsx/detail.jsx; reuses the shared ConditionSwatch.
 */
function DetailPalette({ lang, brush, onPick }: { lang: Lang; brush: string | null; onPick: (id: string) => void }) {
  const [active, setActive] = useState<string>("diagnostic");
  const conds = CONDITIONS.filter((c) => c.group === active);
  const gc = GROUP_COLOR[active];
  return (
    <div>
      <div className="odo-pal-tabs" style={{ borderBottom: "1px solid var(--line-2)", marginBottom: 10 }}>
        {GROUPS.map((g) => (
          <button type="button"
            key={g.id}
            className={"odo-tab" + (active === g.id ? " on" : "")}
            style={{ padding: "7px 9px", fontSize: 12, ...(active === g.id ? { color: g.color } : {}) }}
            onClick={() => setActive(g.id)}
          >
            <span className="odo-tab-dot" style={{ background: g.color }} />
            {g[lang]}
          </button>
        ))}
      </div>
      <div className="odo-dt-pal">
        {conds.map((c) => (
          <button type="button"
            key={c.id}
            className={"odo-chip" + (brush === c.id ? " on" : "")}
            style={brush === c.id ? { borderColor: gc, boxShadow: `0 0 0 2px ${gc}33` } : {}}
            onClick={() => onPick(c.id)}
          >
            <span className="odo-chip-ic"><ConditionSwatch cond={c} /></span>
            <span className="odo-chip-lb">{c[lang]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

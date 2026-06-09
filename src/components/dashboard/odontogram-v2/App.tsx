"use client";

/* ============================================================
   OdontogramV2 — root component (ported from design jsx/app.jsx)
   - Top bar: dentition / numbering / language (ES-EN) toggles.
   - Global state: records (via adapter, NOT localStorage), brush, eraser, selected.
   - apply / removeFinding: optimistic local update + PUT/DELETE through the adapter.
   - Summary (teeth / findings), "Limpiar todo" (reset).
   - Renders OdoDefs + Odontogram + Legend + Palette + DetailPanel (the stubs).
   - WITHOUT the Tweaks panel and WITHOUT warm/dark variants.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { I18N, COND_BY_ID, GROUP_COLOR } from "./data";
import type {
  Records, ToothRecord, Lang, Numbering, Dentition, ApplyKind, RemoveScope, SurfaceLetter,
} from "./types";
import {
  fetchRecords, putFinding, deleteFinding, setNote as apiSetNote, resetOdontogram,
} from "./adapter";
import { OdoDefs } from "./OdoDefs";
import { Odontogram } from "./Odontogram";
import { Palette } from "./Palette";
import { Legend } from "./Legend";
import { DetailPanel } from "./DetailPanel";
import "./odontogram.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-odo",
  display: "swap",
});

/** Immutably clone records[fdi], run fn, prune empty surfaces, return new map. */
function applyToRecords(prev: Records, fdi: number, fn: (r: ToothRecord) => void): Records {
  const rec: ToothRecord = prev[fdi]
    ? JSON.parse(JSON.stringify(prev[fdi]))
    : { surfaces: {}, tooth: [] };
  fn(rec);
  Object.keys(rec.surfaces).forEach((k) => {
    if (!rec.surfaces[k] || !rec.surfaces[k].length) delete rec.surfaces[k];
  });
  return { ...prev, [fdi]: rec };
}

function toggleInArr(arr: string[], id: string) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
}

interface SegOption { v: string; l: string; }
function Seg({ value, set, options }: { value: string; set: (v: string) => void; options: SegOption[] }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button type="button" key={o.v} className={"seg-btn" + (value === o.v ? " on" : "")} onClick={() => set(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function OdontogramV2({ patientId }: { patientId: string }) {
  const [lang, setLang] = useState<Lang>("es");
  const [numbering, setNumbering] = useState<Numbering>("fdi");
  const [dentition, setDentition] = useState<Dentition>("permanent");
  const [brush, setBrush] = useState<string | null>(null);
  const [eraser, setEraser] = useState(false);
  const [records, setRecords] = useState<Records>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = I18N[lang];

  // Load on mount / patient change via the adapter — NOT localStorage.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRecords(patientId)
      .then((recs) => { if (!cancelled) setRecords(recs); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  // Re-sync from the server (recover from a failed optimistic mutation).
  const resync = useCallback(() => {
    fetchRecords(patientId).then(setRecords).catch(() => {});
  }, [patientId]);

  const pickBrush = (id: string) => { setEraser(false); setBrush((b) => (b === id ? null : id)); };
  const pickEraser = () => { setBrush(null); setEraser((e) => !e); };

  const apply = useCallback((fdi: number, kind: ApplyKind, letter?: SurfaceLetter | string) => {
    // ---- eraser ----
    if (eraser) {
      if (kind === "surface" && letter) {
        const lk = String(letter);
        const ids = records[fdi]?.surfaces?.[lk] ?? [];
        setRecords((prev) => applyToRecords(prev, fdi, (r) => { delete r.surfaces[lk]; }));
        ids.forEach((conditionId) =>
          deleteFinding({ patientId, toothNumber: fdi, surface: lk, conditionId }).catch(resync));
      } else {
        const ids = records[fdi]?.tooth ?? [];
        setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.tooth = []; }));
        ids.forEach((conditionId) =>
          deleteFinding({ patientId, toothNumber: fdi, surface: null, conditionId }).catch(resync));
      }
      return;
    }
    // ---- no brush → open detail ----
    if (!brush) { setSelected(fdi); return; }
    const cond = COND_BY_ID[brush];
    if (!cond) return;

    const toSurface = kind === "surface" && cond.target === "surface";
    const lk = toSurface ? String(letter) : null;
    const present = toSurface
      ? !!records[fdi]?.surfaces?.[lk as string]?.includes(brush)
      : !!records[fdi]?.tooth?.includes(brush);

    setRecords((prev) => applyToRecords(prev, fdi, (r) => {
      if (toSurface) {
        const key = lk as string;
        if (!r.surfaces[key]) r.surfaces[key] = [];
        toggleInArr(r.surfaces[key], brush);
      } else {
        toggleInArr(r.tooth, brush);
      }
    }));

    const op = present
      ? deleteFinding({ patientId, toothNumber: fdi, surface: lk, conditionId: brush })
      : putFinding({ patientId, toothNumber: fdi, surface: lk, conditionId: brush });
    op.catch(resync);
  }, [brush, eraser, records, patientId, resync]);

  const removeFinding = useCallback((fdi: number, scope: RemoveScope, letter: string | undefined, condId: string) => {
    setRecords((prev) => applyToRecords(prev, fdi, (r) => {
      if (scope === "surface" && letter) {
        if (r.surfaces[letter]) {
          const i = r.surfaces[letter].indexOf(condId);
          if (i >= 0) r.surfaces[letter].splice(i, 1);
        }
      } else {
        const i = r.tooth.indexOf(condId);
        if (i >= 0) r.tooth.splice(i, 1);
      }
    }));
    deleteFinding({
      patientId, toothNumber: fdi,
      surface: scope === "surface" ? (letter ?? null) : null,
      conditionId: condId,
    }).catch(resync);
  }, [patientId, resync]);

  const clearTooth = useCallback((fdi: number) => {
    const rec = records[fdi];
    setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.tooth = []; r.surfaces = {}; r.note = ""; }));
    if (!rec) return;
    (rec.tooth || []).forEach((conditionId) =>
      deleteFinding({ patientId, toothNumber: fdi, surface: null, conditionId }).catch(resync));
    Object.entries(rec.surfaces || {}).forEach(([letter, arr]) =>
      arr.forEach((conditionId) =>
        deleteFinding({ patientId, toothNumber: fdi, surface: letter, conditionId }).catch(resync)));
    if (rec.note) apiSetNote(patientId, fdi, "").catch(resync);
  }, [records, patientId, resync]);

  const handleNote = useCallback((fdi: number, txt: string) => {
    setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.note = txt; }));
    apiSetNote(patientId, fdi, txt).catch(resync);
  }, [patientId, resync]);

  const clearAll = () => {
    const ok = window.confirm(lang === "es" ? "¿Borrar todo el odontograma?" : "Clear the whole chart?");
    if (!ok) return;
    setRecords({});
    setSelected(null);
    resetOdontogram(patientId).catch(resync);
  };

  // summary counts
  const toothCount = Object.keys(records).length;
  let findingCount = 0;
  Object.values(records).forEach((r) => {
    findingCount += (r.tooth || []).length;
    Object.values(r.surfaces || {}).forEach((a) => { findingCount += a.length; });
  });

  const activeBrushCond = brush ? COND_BY_ID[brush] : null;

  return (
    <div className={`odo-app ${jakarta.variable}`}>
      <OdoDefs />

      {/* ===== Top bar ===== */}
      <header className="odo-top">
        <div className="odo-brand">
          <span className="odo-brand-mark">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7.5 2.5C5 2.5 3.2 4.6 3.4 7.3c.2 2.4 1 3.9 1.5 6 .4 1.7.4 4.2 1.2 6 .4.9 1.6.9 2-.1.6-1.6.7-3.9 1.6-3.9s1 2.3 1.6 3.9c.4 1 1.6 1 2 .1.8-1.8.8-4.3 1.2-6 .5-2.1 1.3-3.6 1.5-6C16.8 4.6 15 2.5 12.5 2.5c-1.5 0-2 .8-2.5.8s-1-.8-2.5-.8z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <div className="odo-title">{t.title}</div>
            <div className="odo-sub">{t.subtitle}</div>
          </div>
        </div>

        <div className="odo-top-controls">
          <div className="ctl">
            <label>{t.dentition}</label>
            <Seg value={dentition} set={(v) => setDentition(v as Dentition)} options={[
              { v: "permanent", l: t.permanent }, { v: "mixed", l: t.mixed }, { v: "primary", l: t.primary },
            ]} />
          </div>
          <div className="ctl">
            <label>{t.numbering}</label>
            <Seg value={numbering} set={(v) => setNumbering(v as Numbering)} options={[
              { v: "fdi", l: "FDI" }, { v: "universal", l: "Univ." }, { v: "palmer", l: "Palmer" },
            ]} />
          </div>
          <div className="ctl">
            <label>{t.language}</label>
            <Seg value={lang} set={(v) => setLang(v as Lang)} options={[{ v: "es", l: "ES" }, { v: "en", l: "EN" }]} />
          </div>
        </div>
      </header>

      {/* ===== Chart ===== */}
      <main className="odo-main">
        <div className="odo-chart-card">
          <div className="odo-chart-head">
            <div className="odo-hint">
              {error ? (
                <span style={{ color: "#d8504f" }}>{error}</span>
              ) : activeBrushCond ? (
                <span><b style={{ color: GROUP_COLOR[activeBrushCond.group] }}>{activeBrushCond[lang]}</b> — {t.clickFace}</span>
              ) : eraser ? (
                <span><b>{t.eraser}</b> — {t.clickFace}</span>
              ) : (
                <span>{t.selectTool}</span>
              )}
            </div>
            <div className="odo-summary">
              <span><b>{toothCount}</b> {t.teeth}</span>
              <span><b>{findingCount}</b> {t.findings}</span>
              <button type="button" className="odo-clearall" onClick={clearAll}>{t.clearAll}</button>
            </div>
          </div>
          <div className="odo-chart-scroll" aria-busy={loading}>
            <Odontogram
              dentition={dentition}
              lang={lang}
              numbering={numbering}
              records={records}
              brush={brush}
              eraser={eraser}
              selected={selected}
              onApply={apply}
              onSelect={(fdi) => setSelected(fdi)}
            />
          </div>
          <Legend lang={lang} />
        </div>

        {/* ===== Palette ===== */}
        <Palette lang={lang} brush={brush} eraser={eraser} onPick={pickBrush} onEraser={pickEraser} />
      </main>

      {/* ===== Detail panel ===== */}
      {selected != null && (
        <DetailPanel
          fdi={selected}
          lang={lang}
          numbering={numbering}
          record={records[selected] || { surfaces: {}, tooth: [] }}
          brush={brush}
          eraser={eraser}
          onApply={apply}
          onClose={() => setSelected(null)}
          onClearTooth={() => clearTooth(selected)}
          onNote={(txt) => handleNote(selected, txt)}
          onRemove={removeFinding}
          onPick={pickBrush}
        />
      )}
    </div>
  );
}

export default OdontogramV2;

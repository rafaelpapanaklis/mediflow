"use client";

/* ============================================================
   OdontogramV2 — root component (ported from design jsx/app.jsx)
   - Top bar: dentition / numbering / language (ES-EN) toggles.
   - Global state: records (via adapter, NOT localStorage), brush, eraser, selected.
   - apply / removeFinding: optimistic local update + escritura por la cola de
     autoguardado (autosave.ts): sin botón «Guardar», con «Guardando… /
     Guardado», reintento y aviso si falla — nunca revierte lo marcado.
   - Summary (teeth / findings), "Limpiar todo" (reset).
   - Renders OdoDefs + Odontogram + Legend + Palette + DetailPanel (the stubs).
   - WITHOUT the Tweaks panel and WITHOUT warm/dark variants.
   ============================================================ */
import { memo, useState, useEffect, useCallback, useRef } from "react";
import { jakarta } from "@/fonts/odo";
import { I18N, COND_BY_ID, GROUP_COLOR } from "./data";
import type {
  Records, ToothRecord, Lang, Numbering, Dentition, ApplyKind, RemoveScope, SurfaceLetter,
  OdontogramV2Props,
} from "./types";
import { EMPTY_RECORD } from "./types";
import {
  fetchOdontogram, putFinding, deleteFinding, setNote as apiSetNote, resetOdontogram,
} from "./adapter";
import { SaveQueue, saveQueueFor, bindBrowserCopy, bindBrowserCopyOffline, type KeyValueStore, type SaveOp, type SaveStatus } from "./autosave";
import { OdoDefs } from "./OdoDefs";
import { Odontogram } from "./Odontogram";
import { Palette } from "./Palette";
import { Legend } from "./Legend";
import { DetailPanel } from "./DetailPanel";
import "./odontogram.css";

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

/** La escritura real de cada operación de la cola. */
function sendOp(patientId: string, op: SaveOp, opts: { keepalive: boolean }): Promise<void> {
  switch (op.kind) {
    case "put": return putFinding({ patientId, toothNumber: op.toothNumber, surface: op.surface, conditionId: op.conditionId }, opts);
    case "delete": return deleteFinding({ patientId, toothNumber: op.toothNumber, surface: op.surface, conditionId: op.conditionId }, opts);
    case "note": return apiSetNote(patientId, op.toothNumber, op.text, opts);
    case "reset": return resetOdontogram(patientId, opts);
  }
}

/**
 * Lee el odontograma del servidor y le pinta encima lo pendiente. Si mientras
 * llegaba la respuesta la cola confirmó o encoló algo, esa lectura puede ser
 * de ANTES de una escritura ya hecha (la marca «desaparecería»): se vuelve a
 * pedir. Tras varios intentos con el doctor marcando sin parar, `force` decide
 * si se usa igual (carga inicial: hace falta el resto de la boca) o se deja
 * la pantalla como está (recarga al volver a la pestaña).
 */
async function fetchConsistent(patientId: string, queue: SaveQueue | null, force: boolean): Promise<Records | null> {
  for (let i = 0; i < 4; i++) {
    const v = queue?.getVersion();
    const { records, clinicId } = await fetchOdontogram(patientId);
    if (!queue) return records;
    // con la clínica de la sesión ya se sabe la llave de la copia del
    // navegador: se engancha y se recupera lo que quedó sin mandar (O1)
    if (clinicId && bindBrowserCopy(queue, browserStore(), clinicId, patientId) > 0) continue;
    if (queue.getVersion() === v || (force && i === 3)) return queue.overlay(records);
  }
  return null;
}

function browserStore(): KeyValueStore | null {
  try { return window.localStorage; } catch { return null; /* navegación privada o bloqueado */ }
}

/** «Guardando… / Guardado / sin conexión / no se guardó», discreto, junto al resumen. */
function SaveIndicator({ status, lang, onRetry, onDiscard }: {
  status: SaveStatus; lang: Lang; onRetry: () => void; onDiscard: () => void;
}) {
  const t = I18N[lang];
  if (status.state === "idle") return null;
  if (status.state === "saving") return <span className="odo-save odo-save-busy" role="status">{t.saving}</span>;
  if (status.state === "saved") return <span className="odo-save odo-save-ok" role="status">✓ {t.saved}</span>;
  const fatal = status.state === "error";
  return (
    <span className="odo-save odo-save-err" role="alert" title={status.error}>
      {fatal ? t.saveFailed : t.saveRetrying}
      {fatal && status.error ? <span className="odo-save-why">{status.error}</span> : null}
      <button type="button" className="odo-save-btn" onClick={onRetry}>{t.saveRetry}</button>
      {fatal && <button type="button" className="odo-save-btn" onClick={onDiscard}>{t.saveDiscard}</button>}
    </span>
  );
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

export const OdontogramV2 = memo(function OdontogramV2({ patientId, value, onChange, dedupeLegend, edgeScrollHint }: OdontogramV2Props) {
  // Modo CONTROLADO (foto por consulta): si llegan value+onChange, el estado lo
  // maneja el padre y NO se toca el servidor. Si no, modo VIVO (como la pestaña).
  const controlled = value !== undefined && !!onChange;
  const [lang, setLang] = useState<Lang>("es");
  const [numbering, setNumbering] = useState<Numbering>("fdi");
  const [dentition, setDentition] = useState<Dentition>("permanent");
  const [brush, setBrush] = useState<string | null>(null);
  const [eraser, setEraser] = useState(false);
  const [internalRecords, setInternalRecords] = useState<Records>({});
  const records = controlled ? (value ?? {}) : internalRecords;
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState<string | null>(null);
  const t = I18N[lang];

  // Cola de autoguardado del modo VIVO: una por paciente y por pestaña, que
  // sobrevive a que este componente se desmonte con algo pendiente.
  const queue: SaveQueue | null = controlled
    ? null
    : saveQueueFor(patientId, () => new SaveQueue({ send: (op, opts) => sendOp(patientId, op, opts) }));
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => queue?.getStatus() ?? { state: "idle", pending: 0 });
  useEffect(() => {
    if (!queue) return;
    setSaveStatus(queue.getStatus());
    return queue.subscribe(setSaveStatus);
  }, [queue]);

  // setRecords unificado: en controlado -> onChange (soporta updater funcional);
  // en vivo -> estado interno. ctrlRef lo mantiene estable (no rompe las deps).
  const ctrlRef = useRef({ controlled, value, onChange });
  ctrlRef.current = { controlled, value, onChange };
  // `records` por ref (mismo patrón que ctrlRef): `apply` lo lee al momento del
  // click sin llevar `records` en sus deps → identidad estable para React.memo.
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const setRecords = useCallback((updater: Records | ((prev: Records) => Records)) => {
    const c = ctrlRef.current;
    if (c.controlled) {
      const prev = c.value ?? {};
      const next = typeof updater === "function" ? (updater as (p: Records) => Records)(prev) : updater;
      c.onChange?.(next);
    } else {
      setInternalRecords(updater);
    }
  }, []);

  // Load on mount / patient change via the adapter. localStorage NO guarda el
  // odontograma: solo lo pendiente de mandar (autosave.ts, revisión t4 O1).
  // En modo controlado el estado viene del padre: no se carga del servidor.
  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // lo que aún no llegó al servidor se pinta encima: no se pierde al volver
    fetchConsistent(patientId, queueRef.current, true)
      .then((recs) => { if (!cancelled && recs) setInternalRecords(recs); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Error");
        // sin red al abrir: lo que quedó pendiente (y lo que se marque ahora)
        // sigue guardándose en el navegador y se ve, aunque falte el resto
        const q = queueRef.current;
        if (q) { bindBrowserCopyOffline(q, browserStore(), patientId); setInternalRecords(q.overlay({})); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId, controlled]);

  // Re-sync from the server (al descartar lo que no se pudo guardar, o al
  // volver a la pestaña: otra pestaña pudo cambiar el odontograma).
  const resync = useCallback(() => {
    if (ctrlRef.current.controlled) return;
    fetchConsistent(patientId, queueRef.current, false)
      .then((recs) => { if (recs) setInternalRecords(recs); })
      .catch(() => {});
  }, [patientId]);

  // Encola una escritura (solo en modo vivo; el controlado lo guarda el padre).
  const save = useCallback((op: SaveOp) => { queueRef.current?.enqueue(op); }, []);

  // En pantalla: el indicador de aquí avisa (el aviso fijo de la página no
  // hace falta). Los avisos de cierre de página viven en la cola (autosave.ts),
  // no aquí: siguen activos cuando este componente ya se desmontó.
  useEffect(() => {
    if (!queue) return;
    const detach = queue.attach();
    // al volver a la pestaña se trae lo que otra pestaña haya cambiado (si
    // aquí no queda nada pendiente)
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !queue.hasPending()) resync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      // se desmonta (otra pestaña de la ficha): lo tecleado sale ya y la cola sigue sola
      queue.flush();
      detach();
    };
  }, [queue, resync]);

  const pickBrush = useCallback((id: string) => { setEraser(false); setBrush((b) => (b === id ? null : id)); }, []);
  const pickEraser = useCallback(() => { setBrush(null); setEraser((e) => !e); }, []);
  const handleSelect = useCallback((fdi: number) => setSelected(fdi), []);

  const apply = useCallback((fdi: number, kind: ApplyKind, letter?: SurfaceLetter | string) => {
    const records = recordsRef.current;
    const live = !ctrlRef.current.controlled;
    // ---- eraser ----
    if (eraser) {
      if (kind === "surface" && letter) {
        const lk = String(letter);
        const ids = records[fdi]?.surfaces?.[lk] ?? [];
        setRecords((prev) => applyToRecords(prev, fdi, (r) => { delete r.surfaces[lk]; }));
        if (live) ids.forEach((conditionId) => save({ kind: "delete", toothNumber: fdi, surface: lk, conditionId }));
      } else {
        const ids = records[fdi]?.tooth ?? [];
        setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.tooth = []; }));
        if (live) ids.forEach((conditionId) => save({ kind: "delete", toothNumber: fdi, surface: null, conditionId }));
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

    if (live) save({ kind: present ? "delete" : "put", toothNumber: fdi, surface: lk, conditionId: brush });
  }, [brush, eraser, save]);

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
    if (!ctrlRef.current.controlled) save({
      kind: "delete", toothNumber: fdi,
      surface: scope === "surface" ? (letter ?? null) : null,
      conditionId: condId,
    });
  }, [save]);

  const clearTooth = useCallback((fdi: number) => {
    const rec = records[fdi];
    setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.tooth = []; r.surfaces = {}; r.note = ""; }));
    if (!rec) return;
    if (!ctrlRef.current.controlled) {
      (rec.tooth || []).forEach((conditionId) => save({ kind: "delete", toothNumber: fdi, surface: null, conditionId }));
      Object.entries(rec.surfaces || {}).forEach(([letter, arr]) =>
        arr.forEach((conditionId) => save({ kind: "delete", toothNumber: fdi, surface: letter, conditionId })));
      if (rec.note) save({ kind: "note", toothNumber: fdi, text: "" });
    }
  }, [records, save]);

  // Nota firme (dictado): se guarda ya.
  const handleNote = useCallback((fdi: number, txt: string) => {
    setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.note = txt; }));
    if (!ctrlRef.current.controlled) save({ kind: "note", toothNumber: fdi, text: txt });
  }, [save]);
  // Nota mientras se teclea: se ve al momento y se guarda sola tras una pausa.
  const handleNoteDraft = useCallback((fdi: number, txt: string) => {
    setRecords((prev) => applyToRecords(prev, fdi, (r) => { r.note = txt; }));
    queueRef.current?.noteChanged(fdi, txt);
  }, []);
  const handleNoteFlush = useCallback((fdi: number) => { queueRef.current?.flushNote(fdi); }, []);

  const clearAll = () => {
    const ok = window.confirm(lang === "es" ? "¿Borrar todo el odontograma?" : "Clear the whole chart?");
    if (!ok) return;
    setRecords({});
    setSelected(null);
    if (!ctrlRef.current.controlled) save({ kind: "reset" });
  };

  const discardUnsaved = () => {
    queueRef.current?.discard();
    resync();
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
      <section className="odo-main" aria-label="Odontograma">
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
              {loading ? (
                <span className="odo-summary-loading">{t.loadingChart}</span>
              ) : (
                <>
                  <span><b>{toothCount}</b> {t.teeth}</span>
                  <span><b>{findingCount}</b> {t.findings}</span>
                </>
              )}
              {queue && (
                <SaveIndicator status={saveStatus} lang={lang} onRetry={() => queue.retryNow()} onDiscard={discardUnsaved} />
              )}
              <button type="button" className="odo-clearall" onClick={clearAll}>{t.clearAll}</button>
            </div>
          </div>
          <div className={"odo-chart-scroll-wrap" + (edgeScrollHint ? " odo-edge-hint" : "")}>
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
                onSelect={handleSelect}
              />
            </div>
            {/* N14 (ws1-t10 ronda 4): mientras carga, un odontograma vacío de
               verdad y uno que todavía no respondió se veían IGUAL («0
               dientes · 0 hallazgos», todos los dientes en blanco). Este aviso
               es lo único que distingue "no hay nada" de "todavía no sé". */}
            {loading && (
              <div className="odo-2d-loading" aria-hidden="true">{t.loadingChart}</div>
            )}
          </div>
          {!dedupeLegend && <Legend lang={lang} />}
        </div>

        {/* ===== Palette ===== */}
        <Palette lang={lang} brush={brush} eraser={eraser} onPick={pickBrush} onEraser={pickEraser} />
      </section>

      {/* ===== Detail panel ===== */}
      {selected != null && (
        <DetailPanel
          fdi={selected}
          lang={lang}
          numbering={numbering}
          record={records[selected] || EMPTY_RECORD}
          brush={brush}
          eraser={eraser}
          onApply={apply}
          onClose={() => setSelected(null)}
          onClearTooth={() => clearTooth(selected)}
          onNote={handleNote}
          onNoteDraft={handleNoteDraft}
          onNoteFlush={handleNoteFlush}
          onRemove={removeFinding}
          onPick={pickBrush}
        />
      )}
    </div>
  );
});

export default OdontogramV2;

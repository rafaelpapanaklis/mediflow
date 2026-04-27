"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  RotateCcw,
  FileDown,
  Keyboard,
  X,
} from "lucide-react";
import {
  FULL_TOOTH_STATES,
  LOWER_FDI,
  STATE_COLOR,
  STATE_LABEL,
  SURFACE_LABEL,
  SURFACE_STATES,
  TOOLBAR_STATES,
  UPPER_FDI,
  notationLabel,
  toothTypeName,
  type Notation,
  type SurfaceKey,
  type ToothState,
} from "./odontogram-data";
import { Tooth } from "./tooth";
import styles from "./odontogram.module.css";

interface OdontogramProps {
  patientId: string;
  readOnly?: boolean;
}

interface ServerEntry {
  id: string;
  toothNumber: number;
  surface: SurfaceKey | null;
  state: ToothState;
  notes: string | null;
  updatedAt: string;
}

/** State derivado de las entries del server, indexado por FDI. */
interface PatientToothState {
  fullToothState: ToothState | null;
  surfaces: Partial<Record<SurfaceKey, ToothState>>;
}

function entriesToMap(entries: ServerEntry[]): Map<number, PatientToothState> {
  const map = new Map<number, PatientToothState>();
  for (const e of entries) {
    let cur = map.get(e.toothNumber);
    if (!cur) {
      cur = { fullToothState: null, surfaces: {} };
      map.set(e.toothNumber, cur);
    }
    if (e.surface === null) cur.fullToothState = e.state;
    else cur.surfaces[e.surface] = e.state;
  }
  return map;
}

interface LastAction {
  fdi: number;
  surface: SurfaceKey | null;
  state: ToothState;
}

export function Odontogram({ patientId, readOnly = false }: OdontogramProps) {
  const [entries, setEntries] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMode, setActiveMode] = useState<ToothState | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notation, setNotation] = useState<Notation>("FDI");
  const [dentition, setDentition] = useState<"PERMANENTE" | "DECIDUA">("PERMANENTE");
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [pending, setPending] = useState(false);
  const inflightRef = useRef<AbortController | null>(null);

  // Inicial fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/odontogram?patientId=${patientId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "fetch_failed");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err.message ?? "No se pudo cargar el odontograma");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  // Map indexado para render
  const teethMap = useMemo(() => entriesToMap(entries), [entries]);

  // Stats (count por estado)
  const stats = useMemo(() => {
    const counts: Record<ToothState, number> = {
      SANO: 0, CARIES: 0, RESINA: 0, CORONA: 0,
      ENDODONCIA: 0, IMPLANTE: 0, AUSENTE: 0, EXTRACCION: 0,
    };
    for (const e of entries) counts[e.state]++;
    return counts;
  }, [entries]);

  // Plan tratamiento sugerido (heurística)
  const plan = useMemo(() => {
    const items: { label: string; tone: "warn" | "info" | "neutral" }[] = [];
    if (stats.CARIES > 0) items.push({ label: `Tratar ${stats.CARIES} caries (resina o corona según extensión)`, tone: "warn" });
    if (stats.ENDODONCIA > 0) items.push({ label: `${stats.ENDODONCIA} endodoncia${stats.ENDODONCIA === 1 ? "" : "s"} en seguimiento`, tone: "info" });
    if (stats.AUSENTE > 0) items.push({ label: `Considerar ${stats.AUSENTE} implante${stats.AUSENTE === 1 ? "" : "s"} para diente ausente`, tone: "info" });
    if (stats.CORONA > 0) items.push({ label: `Control periódico de ${stats.CORONA} corona${stats.CORONA === 1 ? "" : "s"}`, tone: "neutral" });
    if (items.length === 0) items.push({ label: "Sin tratamientos pendientes — boca sana", tone: "neutral" });
    return items;
  }, [stats]);

  /* ─── Mutaciones ──────────────────────────────────────────── */

  const upsert = useCallback(async (
    fdi: number,
    surface: SurfaceKey | null,
    state: ToothState,
  ) => {
    if (readOnly) return;
    // Si state es SANO sobre una superficie con estado previo → DELETE
    const isFullTooth = surface === null;
    const prev = entries.find((e) =>
      e.toothNumber === fdi && (e.surface ?? null) === surface,
    );

    if (state === "SANO") {
      if (!prev) return; // ya estaba sano
      // Optimistic
      setEntries((es) => es.filter((e) => e.id !== prev.id));
      try {
        const res = await fetch(`/api/odontogram`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId, toothNumber: fdi, surface }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "delete_failed");
      } catch (err) {
        setEntries((es) => [...es, prev]); // rollback
        toast.error(err instanceof Error ? err.message : "Error al borrar");
        return;
      }
      setLastAction({ fdi, surface, state });
      return;
    }

    // Optimistic upsert: si existe entry, update; si no, fake-id temporal hasta respuesta
    const optimistic: ServerEntry = prev
      ? { ...prev, state }
      : {
          id: `tmp-${Date.now()}`,
          toothNumber: fdi,
          surface,
          state,
          notes: null,
          updatedAt: new Date().toISOString(),
        };
    setEntries((es) => {
      const without = prev ? es.filter((e) => e.id !== prev.id) : es;
      return [...without, optimistic];
    });

    try {
      const res = await fetch(`/api/odontogram`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, toothNumber: fdi, surface, state }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "upsert_failed");
      const data = await res.json();
      // Reemplaza optimistic con respuesta real (sobre todo el id)
      setEntries((es) => {
        const without = es.filter((e) => e.id !== optimistic.id);
        return [...without, data.entry];
      });
    } catch (err) {
      // Rollback
      setEntries((es) => {
        const without = es.filter((e) => e.id !== optimistic.id);
        return prev ? [...without, prev] : without;
      });
      toast.error(err instanceof Error ? err.message : "Error al guardar");
      return;
    }

    setLastAction({ fdi, surface, state });
  }, [entries, patientId, readOnly]);

  const applyToTooth = useCallback((fdi: number, state: ToothState, surface?: SurfaceKey) => {
    if (readOnly) return;
    const isFullTooth = !surface || FULL_TOOTH_STATES.includes(state);
    if (isFullTooth) {
      void upsert(fdi, null, state);
      // Si ahora es full-tooth, removemos cualquier surface state previo
      const surfacesToDelete = entries.filter(
        (e) => e.toothNumber === fdi && e.surface !== null && e.state !== "SANO",
      );
      surfacesToDelete.forEach((e) => {
        if (e.surface) void upsert(fdi, e.surface, "SANO");
      });
    } else {
      void upsert(fdi, surface!, state);
    }
  }, [entries, readOnly, upsert]);

  const handleSurfaceClick = useCallback((fdi: number) => {
    return (surface: SurfaceKey, shiftKey: boolean) => {
      if (readOnly) return;
      if (shiftKey) {
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(fdi)) next.delete(fdi);
          else next.add(fdi);
          return next;
        });
        return;
      }
      if (!activeMode) {
        toast("Selecciona primero un estado de la barra superior", { icon: "ℹ️" });
        return;
      }
      // Si activeMode es full-tooth, aplica al diente entero ignorando surface
      if (FULL_TOOTH_STATES.includes(activeMode)) {
        applyToTooth(fdi, activeMode);
        return;
      }
      applyToTooth(fdi, activeMode, surface);
    };
  }, [activeMode, applyToTooth, readOnly]);

  const handleToothClick = useCallback((fdi: number) => {
    return (shiftKey: boolean) => {
      if (readOnly) return;
      if (shiftKey) {
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(fdi)) next.delete(fdi);
          else next.add(fdi);
          return next;
        });
        return;
      }
      if (activeMode && FULL_TOOTH_STATES.includes(activeMode)) {
        applyToTooth(fdi, activeMode);
      }
    };
  }, [activeMode, applyToTooth, readOnly]);

  // Multi-select: aplicar al activar un estado mientras hay selección
  const applyToSelected = useCallback((state: ToothState) => {
    if (selected.size === 0) {
      setActiveMode(state);
      return;
    }
    selected.forEach((fdi) => applyToTooth(fdi, state));
    setSelected(new Set());
    setActiveMode(null);
  }, [selected, applyToTooth]);

  // Atajos teclado: 1-8 → estado, Esc → cancelar
  useEffect(() => {
    if (readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;
      if (e.key === "Escape") {
        setActiveMode(null);
        setSelected(new Set());
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 8) {
        const st = TOOLBAR_STATES[n - 1]!;
        applyToSelected(st);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [applyToSelected, readOnly]);

  const handleReset = useCallback(async () => {
    if (readOnly) return;
    if (!confirm("¿Borrar TODAS las marcas del odontograma? Esta acción no se puede deshacer.")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/odontogram/reset?patientId=${patientId}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "reset_failed");
      setEntries([]);
      setLastAction(null);
      toast.success("Odontograma reiniciado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reiniciar");
    } finally {
      setPending(false);
    }
  }, [patientId, readOnly]);

  const handleGeneratePdf = useCallback(() => {
    // Stub: window.print() con vista actual. PDF real con react-pdf/jsPDF en
    // iteración futura.
    window.print();
  }, []);

  /* ─── Render ──────────────────────────────────────────── */

  return (
    <div className={styles.odontogram} data-active-mode={activeMode ?? "none"}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarChips} role="toolbar" aria-label="Estados">
          {TOOLBAR_STATES.map((st, idx) => {
            const isActive = activeMode === st;
            return (
              <button
                key={st}
                type="button"
                className={`${styles.chip} ${isActive ? styles.chipActive : ""}`}
                style={{ "--mf-chip-color": STATE_COLOR[st] } as React.CSSProperties}
                onClick={() => applyToSelected(st)}
                disabled={readOnly}
                aria-pressed={isActive}
                title={`${STATE_LABEL[st]} (atajo ${idx + 1})`}
              >
                <span className={styles.chipDot} aria-hidden />
                <span>{STATE_LABEL[st]}</span>
                <kbd className={styles.chipKbd}>{idx + 1}</kbd>
              </button>
            );
          })}
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.segmented} role="tablist" aria-label="Notación">
            {(["FDI", "UNIVERSAL", "PALMER"] as Notation[]).map((n) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={notation === n}
                className={`${styles.segmentedBtn} ${notation === n ? styles.active : ""}`}
                onClick={() => setNotation(n)}
              >
                {n[0]! + n.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className={styles.segmented} role="tablist" aria-label="Dentición">
            {(["PERMANENTE", "DECIDUA"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={dentition === d}
                className={`${styles.segmentedBtn} ${dentition === d ? styles.active : ""}`}
                onClick={() => setDentition(d)}
                disabled={d === "DECIDUA"}
                title={d === "DECIDUA" ? "Dentición decidua próximamente" : ""}
              >
                {d[0]! + d.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <button
              type="button"
              className={styles.clearSelected}
              onClick={() => setSelected(new Set())}
            >
              <X size={11} aria-hidden /> Quitar selección ({selected.size})
            </button>
          )}
          <button
            type="button"
            className={styles.resetBtn}
            onClick={handleReset}
            disabled={readOnly || pending || entries.length === 0}
            title="Borrar todas las marcas"
          >
            <RotateCcw size={12} aria-hidden /> Reiniciar
          </button>
        </div>
      </div>

      {/* Body: arches + sidebar */}
      <div className={styles.body}>
        <div className={styles.arches}>
          {loading ? (
            <div className={styles.loading}>Cargando odontograma…</div>
          ) : (
            <>
              <div className={styles.archLabel}>Maxilar superior</div>
              <div className={styles.arch}>
                {UPPER_FDI.map((fdi) => {
                  const data = teethMap.get(fdi);
                  return (
                    <Tooth
                      key={fdi}
                      fdi={fdi}
                      notation={notation}
                      surfaces={data?.surfaces ?? {}}
                      fullToothState={data?.fullToothState ?? null}
                      selected={selected.has(fdi)}
                      activeMode={activeMode}
                      onSurfaceClick={handleSurfaceClick(fdi)}
                      onToothClick={handleToothClick(fdi)}
                    />
                  );
                })}
              </div>
              <div className={styles.archGap} aria-hidden />
              <div className={styles.arch}>
                {LOWER_FDI.map((fdi) => {
                  const data = teethMap.get(fdi);
                  return (
                    <Tooth
                      key={fdi}
                      fdi={fdi}
                      notation={notation}
                      surfaces={data?.surfaces ?? {}}
                      fullToothState={data?.fullToothState ?? null}
                      selected={selected.has(fdi)}
                      activeMode={activeMode}
                      onSurfaceClick={handleSurfaceClick(fdi)}
                      onToothClick={handleToothClick(fdi)}
                    />
                  );
                })}
              </div>
              <div className={styles.archLabel}>Maxilar inferior</div>
            </>
          )}

          {/* Status footer */}
          <div className={styles.statusFooter}>
            <span className={styles.statusLabel}>Última acción</span>
            {lastAction ? (
              <span
                className={styles.statusPill}
                style={{ "--mf-status-color": STATE_COLOR[lastAction.state] } as React.CSSProperties}
              >
                Diente {notationLabel(lastAction.fdi, notation)}
                {lastAction.surface ? ` · ${SURFACE_LABEL[lastAction.surface]}` : ""}
                {" · "}
                <strong>{STATE_LABEL[lastAction.state]}</strong>
              </span>
            ) : (
              <span className={styles.statusEmpty}>
                {activeMode
                  ? `Modo activo: ${STATE_LABEL[activeMode]} — click en una superficie`
                  : "Selecciona un estado y luego una superficie"}
              </span>
            )}
            <div className={styles.kbdHint}>
              <Keyboard size={11} aria-hidden />
              <span>1-8 estado · Esc cancelar · Shift-click multi</span>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className={styles.sidebar} aria-label="Resumen del odontograma">
          <section className={styles.sideCard}>
            <h3 className={styles.sideCardTitle}>Estado clínico</h3>
            <ul className={styles.statList}>
              {(["CARIES", "RESINA", "CORONA", "ENDODONCIA", "IMPLANTE", "AUSENTE", "EXTRACCION"] as ToothState[]).map((st) => (
                <li key={st} className={styles.statItem}>
                  <span className={styles.statDot} style={{ background: STATE_COLOR[st] }} />
                  <span className={styles.statLabel}>{STATE_LABEL[st]}</span>
                  <span className={styles.statCount}>{stats[st]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.sideCard}>
            <h3 className={styles.sideCardTitle}>Plan tratamiento sugerido</h3>
            <ul className={styles.planList}>
              {plan.map((p, i) => (
                <li key={i} className={`${styles.planItem} ${styles[`tone-${p.tone}`] ?? ""}`}>
                  {p.label}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.pdfBtn}
              onClick={handleGeneratePdf}
            >
              <FileDown size={12} aria-hidden /> Generar plan PDF
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

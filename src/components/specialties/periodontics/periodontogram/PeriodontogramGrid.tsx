"use client";
// Periodontics — grid 6×32 del periodontograma. SPEC §6.4.
//
// Two arcades (superior 18-11/21-28, inferior 48-41/31-38), cada una con 16
// columnas. Reducer interno + autosave debounced de cada UPSERT_SITE al
// servidor.

import { useCallback, useReducer, useEffect, useMemo } from "react";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import {
  FDI_ORDER_UPPER,
  FDI_ORDER_LOWER,
  type SitePos,
} from "@/lib/periodontics/site-helpers";
import { computePerioMetrics, type PerioMetrics } from "@/lib/periodontics/periodontogram-math";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { ToothColumn } from "./ToothColumn";
import {
  perioReducer,
  type PerioState,
  type PerioAction,
  getTooth,
} from "./reducer";

export interface PeriodontogramGridProps {
  recordId: string;
  initialSites: Site[];
  initialTeeth: ToothLevel[];
  /**
   * Persiste un sitio. Llamado tras debounce 300ms.
   * Devuelve falso si rechazó (UI muestra toast, opcional).
   */
  onPersistSite: (site: Site) => Promise<void>;
  /** Persiste un diente (ausente / movilidad / furca). */
  onPersistTooth: (tooth: ToothLevel) => Promise<void>;
  /** Notifica métricas para que el header las pinte. */
  onMetricsChange?: (m: PerioMetrics) => void;
  /** Notifica el sitio activo para que el KeyboardCaptureLayer reaccione. */
  onCursorChange?: (cursor: { fdi: number; position: SitePos } | null) => void;
  /** Notifica clic en un diente para abrir el detalle drawer. */
  onToothClick?: (fdi: number) => void;
  /** Si true, deshabilita interacción (mobile o read-only). */
  readOnly?: boolean;
}

/**
 * Imperative ref expuesto por el grid para que `KeyboardCaptureLayer` y
 * `PeriodontogramaTab` puedan despachar acciones (toggle BoP, mover cursor).
 */
export type PerioGridDispatch = (action: PerioAction) => void;

export function PeriodontogramGrid(props: PeriodontogramGridProps) {
  const initialState: PerioState = useMemo(
    () => ({
      recordId: props.recordId,
      sites: props.initialSites,
      teeth: props.initialTeeth,
      cursor: { fdi: FDI_ORDER_UPPER[0]!, position: "MV" },
    }),
    [props.recordId, props.initialSites, props.initialTeeth],
  );

  const [state, dispatch] = useReducer(perioReducer, initialState);

  const debouncedPersistSite = useDebouncedCallback((site: Site) => {
    void props.onPersistSite(site);
  }, 300);

  const debouncedPersistTooth = useDebouncedCallback((tooth: ToothLevel) => {
    void props.onPersistTooth(tooth);
  }, 300);

  // Notificar métricas y cursor cuando cambian.
  const metrics = useMemo(() => computePerioMetrics(state.sites, state.teeth), [
    state.sites,
    state.teeth,
  ]);
  useEffect(() => {
    props.onMetricsChange?.(metrics);
  }, [metrics, props]);
  useEffect(() => {
    props.onCursorChange?.(state.cursor);
  }, [state.cursor, props]);

  const handleSiteClick = useCallback(
    (fdi: number, position: SitePos) => {
      if (props.readOnly) return;
      dispatch({ type: "SET_CURSOR", fdi, position });
    },
    [props.readOnly],
  );

  const handleToothClick = useCallback(
    (fdi: number) => {
      props.onToothClick?.(fdi);
    },
    [props],
  );

  // Indexa sitios por (fdi → position → site) para lookup O(1) en cada columna.
  const sitesByFdi = useMemo(() => {
    const out = new Map<number, Partial<Record<SitePos, Site>>>();
    for (const s of state.sites) {
      const bucket = out.get(s.fdi) ?? {};
      bucket[s.position] = s;
      out.set(s.fdi, bucket);
    }
    return out;
  }, [state.sites]);

  return (
    <div
      data-perio-grid
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 12,
        background: "var(--bg, #0b0d11)",
        borderRadius: 8,
        overflowX: "auto",
        position: "relative",
      }}
    >
      {/* Arcada superior */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${FDI_ORDER_UPPER.length}, minmax(38px, 1fr))`,
          gap: 4,
        }}
      >
        {FDI_ORDER_UPPER.map((fdi) => (
          <ToothColumn
            key={fdi}
            fdi={fdi}
            tooth={getTooth(state, fdi)}
            sitesByPosition={sitesByFdi.get(fdi) ?? {}}
            cursor={state.cursor}
            isUpperArcade
            onSiteClick={handleSiteClick}
            onToothClick={handleToothClick}
          />
        ))}
      </div>

      <div
        style={{
          height: 1,
          background: "var(--border, #1f2937)",
          margin: "4px 0",
        }}
        aria-hidden
      />

      {/* Arcada inferior */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${FDI_ORDER_LOWER.length}, minmax(38px, 1fr))`,
          gap: 4,
        }}
      >
        {FDI_ORDER_LOWER.map((fdi) => (
          <ToothColumn
            key={fdi}
            fdi={fdi}
            tooth={getTooth(state, fdi)}
            sitesByPosition={sitesByFdi.get(fdi) ?? {}}
            cursor={state.cursor}
            isUpperArcade={false}
            onSiteClick={handleSiteClick}
            onToothClick={handleToothClick}
          />
        ))}
      </div>

      {/* Hidden bridge: expose dispatch + persist helpers via window for the
          KeyboardCaptureLayer when both live in the same DOM tree. */}
      <PerioBridge
        dispatch={dispatch}
        persistSite={debouncedPersistSite}
        persistTooth={debouncedPersistTooth}
        readOnly={props.readOnly ?? false}
      />
    </div>
  );
}

/**
 * Hueco invisible que registra la `dispatch` del reducer en el DOM via
 * `data-perio-bridge`. El KeyboardCaptureLayer lee este nodo para llamar
 * acciones desde su layer global. Mantiene React tree limpio.
 */
function PerioBridge({
  dispatch,
  persistSite,
  persistTooth,
  readOnly,
}: {
  dispatch: PerioGridDispatch;
  persistSite: (site: Site) => void;
  persistTooth: (tooth: ToothLevel) => void;
  readOnly: boolean;
}) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { kind: "action"; action: PerioAction }
        | { kind: "persistSite"; site: Site }
        | { kind: "persistTooth"; tooth: ToothLevel };
      if (readOnly) return;
      if (detail.kind === "action") dispatch(detail.action);
      if (detail.kind === "persistSite") persistSite(detail.site);
      if (detail.kind === "persistTooth") persistTooth(detail.tooth);
    };
    window.addEventListener("perio:bridge", handler);
    return () => window.removeEventListener("perio:bridge", handler);
  }, [dispatch, persistSite, persistTooth, readOnly]);
  return null;
}

/** Helper para los componentes externos (KeyboardCaptureLayer) que quieren
 * empujar acciones sin pasarse refs por props. */
export function dispatchPerioAction(action: PerioAction) {
  window.dispatchEvent(
    new CustomEvent("perio:bridge", { detail: { kind: "action", action } }),
  );
}

export function dispatchPerioPersistSite(site: Site) {
  window.dispatchEvent(
    new CustomEvent("perio:bridge", { detail: { kind: "persistSite", site } }),
  );
}

export function dispatchPerioPersistTooth(tooth: ToothLevel) {
  window.dispatchEvent(
    new CustomEvent("perio:bridge", { detail: { kind: "persistTooth", tooth } }),
  );
}

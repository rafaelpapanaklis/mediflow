"use client";
// Periodontics — overlay invisible que captura el teclado mientras el grid
// está enfocado. Convierte el input "5-2" en una acción UPSERT_SITE +
// persistencia debounced. SPEC §6.5 + §5.4.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Site } from "@/lib/periodontics/schemas";
import { parsePdRecInput } from "@/lib/periodontics/keyboard-shortcuts";
import type { SitePos } from "@/lib/periodontics/site-helpers";
import {
  dispatchPerioAction,
  dispatchPerioPersistSite,
} from "./PeriodontogramGrid";

export interface KeyboardCaptureLayerProps {
  cursor: { fdi: number; position: SitePos } | null;
  /**
   * Callback con el sitio actualmente seleccionado, para que el padre
   * pueda armar el `site` completo (con bop/plaque/suppuration actuales).
   */
  resolveSite: (fdi: number, position: SitePos) => Site | undefined;
  /** Si true, deshabilita totalmente la captura. */
  disabled?: boolean;
}

/**
 * Escucha keypresses globales y dispara las acciones del reducer del grid.
 *
 *   Tab          → MOVE_NEXT
 *   Shift+Tab    → MOVE_PREV
 *   Espacio      → TOGGLE_BOP
 *   p            → TOGGLE_PLAQUE
 *   s            → TOGGLE_SUPPURATION
 *   Enter        → confirma input pendiente y avanza
 *   Escape       → cancela buffer
 *   Dígitos / -  → buffer del parser "5-2"
 *
 * Muestra un floating chip con el buffer actual cerca del cursor para que
 * el operador vea lo que está tipeando.
 */
export function KeyboardCaptureLayer(props: KeyboardCaptureLayerProps) {
  const [buffer, setBuffer] = useState("");
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;

  const flushBuffer = useCallback(
    (advance: boolean) => {
      const raw = bufferRef.current;
      if (!props.cursor) {
        setBuffer("");
        return;
      }
      if (!raw) {
        if (advance) dispatchPerioAction({ type: "MOVE_NEXT" });
        return;
      }
      const parsed = parsePdRecInput(raw);
      const existing = props.resolveSite(props.cursor.fdi, props.cursor.position);
      const next: Site = {
        fdi: props.cursor.fdi,
        position: props.cursor.position,
        pdMm: parsed.pdMm ?? existing?.pdMm ?? 0,
        recMm: parsed.recMm ?? existing?.recMm ?? 0,
        bop: existing?.bop ?? false,
        plaque: existing?.plaque ?? false,
        suppuration: existing?.suppuration ?? false,
      };
      dispatchPerioAction({ type: "UPSERT_SITE", site: next });
      dispatchPerioPersistSite(next);
      setBuffer("");
      if (advance) dispatchPerioAction({ type: "MOVE_NEXT" });
    },
    [props],
  );

  useEffect(() => {
    if (props.disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!props.cursor) return;
      // Ignora cuando el foco está en un campo de texto fuera del grid.
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      // Atajos de marcador (no requieren buffer).
      if (e.key === " ") {
        e.preventDefault();
        flushBuffer(false);
        dispatchPerioAction({ type: "TOGGLE_BOP" });
        const cur = props.cursor;
        const after = props.resolveSite(cur.fdi, cur.position);
        if (after) dispatchPerioPersistSite({ ...after, bop: !after.bop });
        return;
      }
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        flushBuffer(false);
        dispatchPerioAction({ type: "TOGGLE_PLAQUE" });
        const cur = props.cursor;
        const after = props.resolveSite(cur.fdi, cur.position);
        if (after) dispatchPerioPersistSite({ ...after, plaque: !after.plaque });
        return;
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        flushBuffer(false);
        dispatchPerioAction({ type: "TOGGLE_SUPPURATION" });
        const cur = props.cursor;
        const after = props.resolveSite(cur.fdi, cur.position);
        if (after) dispatchPerioPersistSite({ ...after, suppuration: !after.suppuration });
        return;
      }

      // Navegación.
      if (e.key === "Tab") {
        e.preventDefault();
        flushBuffer(false);
        dispatchPerioAction({ type: e.shiftKey ? "MOVE_PREV" : "MOVE_NEXT" });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        flushBuffer(true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setBuffer("");
        return;
      }

      // Dígitos / separador → buffer.
      if (/^[\d\-/,]$/.test(e.key)) {
        e.preventDefault();
        setBuffer((b) => (b + e.key).slice(0, 8));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushBuffer, props]);

  if (!buffer) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "8px 16px",
        background: "var(--bg-elev, #1f2937)",
        color: "var(--text-1, #e5e7eb)",
        border: "1px solid var(--brand, #6366f1)",
        borderRadius: 6,
        fontFamily: "monospace",
        fontSize: 16,
        zIndex: 1000,
      }}
    >
      {buffer}
      <span
        style={{ marginLeft: 8, fontSize: 10, color: "var(--text-2, #94a3b8)" }}
      >
        Enter para confirmar · Esc para cancelar
      </span>
    </div>
  );
}

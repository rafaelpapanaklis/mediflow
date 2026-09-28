"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H1:
// el doctor hace clic sobre la radiografía lateral para marcar cada punto;
// arrastra para corregir. Las medidas se recalculan en vivo con la misma
// librería pura que usa el servidor al guardar.

import { useCallback, useRef, useState } from "react";
import { CEPH_LANDMARKS, missingCephLandmarks, type CephLandmarkId, type CephPoints } from "@/lib/orthodontics/cefalometria/landmarks";
import { computeCephMeasurements } from "@/lib/orthodontics/cefalometria/measurements";
import { Btn } from "../../../specialties/orthodontics/redesign/atoms/Btn";

export interface CephalometricTracerProps {
  imageUrl: string;
  initialPoints?: CephPoints;
  onChange?: (points: CephPoints) => void;
  readOnly?: boolean;
}

/** Siguiente punto requerido que falta, o null si ya están todos. */
function nextRequired(points: CephPoints): CephLandmarkId | null {
  const missing = missingCephLandmarks(points);
  return missing[0] ?? null;
}

export function CephalometricTracer({ imageUrl, initialPoints, onChange, readOnly }: CephalometricTracerProps) {
  const [points, setPoints] = useState<CephPoints>(initialPoints ?? {});
  const [dragging, setDragging] = useState<CephLandmarkId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const measurements = computeCephMeasurements(points);
  const pending = nextRequired(points);
  const labelById = Object.fromEntries(CEPH_LANDMARKS.map((l) => [l.id, l.label]));

  const setPoint = useCallback(
    (id: CephLandmarkId, xPct: number, yPct: number) => {
      setPoints((prev) => {
        const next = { ...prev, [id]: { x: xPct, y: yPct } };
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const relativeCoords = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(100, Math.max(0, xPct)), y: Math.min(100, Math.max(0, yPct)) };
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || dragging) return;
    const target = pending;
    if (!target) return;
    const coords = relativeCoords(e);
    if (!coords) return;
    setPoint(target, coords.x, coords.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const coords = relativeCoords(e);
    if (!coords) return;
    setPoint(dragging, coords.x, coords.y);
  };

  return (
    <div>
      <div
        ref={containerRef}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragging(null)}
        className="relative w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black select-none"
        style={{ aspectRatio: "3 / 4", cursor: readOnly ? "default" : pending ? "crosshair" : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Radiografía lateral de cráneo" className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />
        {(Object.keys(points) as CephLandmarkId[]).map((id) => {
          const p = points[id]!;
          return (
            <button
              key={id}
              type="button"
              aria-label={labelById[id] ?? id}
              onPointerDown={(e) => {
                if (readOnly) return;
                e.stopPropagation();
                setDragging(id);
              }}
              className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full bg-violet-500 border-2 border-white shadow"
              style={{ left: `${p.x}%`, top: `${p.y}%`, cursor: readOnly ? "default" : "grab" }}
              title={labelById[id] ?? id}
            />
          );
        })}
      </div>

      {!readOnly ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {pending ? (
              <>
                Haz clic sobre la placa para marcar: <b className="text-slate-700 dark:text-slate-200">{labelById[pending]}</b>
              </>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">Trazado completo — arrastra cualquier punto para corregirlo.</span>
            )}
          </div>
          {Object.keys(points).length > 0 ? (
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                setPoints({});
                onChange?.({});
              }}
            >
              Reiniciar
            </Btn>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-5 gap-2 text-center">
        {(["SNA", "SNB", "ANB", "FMA", "IMPA"] as const).map((key) => (
          <div key={key} className="rounded-md bg-slate-50 dark:bg-slate-800/60 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{key}</div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {measurements[key] !== null ? `${measurements[key]}°` : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

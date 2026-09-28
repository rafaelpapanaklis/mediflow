"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H5:
// marcar puntos sobre la foto de perfil/frente y ver línea E, ángulo
// nasolabial y línea media en vivo. Mismo patrón de clic-para-marcar que
// CephalometricTracer, sobre el catálogo de puntos faciales.

import { useCallback, useRef, useState } from "react";
import { FACIAL_LANDMARKS, type FacialLandmarkId, type FacialPoints } from "@/lib/orthodontics/fotos/landmarks";
import { computeELine, computeMidlineDeviation, computeNasolabialAngle } from "@/lib/orthodontics/fotos/facial-analysis";
import { Btn } from "../redesign/atoms/Btn";
import orto from "../redesign/orto.module.css";

export interface PhotoLineAnalyzerProps {
  imageUrl: string;
  view: "perfil" | "frente";
  initialPoints?: FacialPoints;
  onChange?: (points: FacialPoints) => void;
}

export function PhotoLineAnalyzer({ imageUrl, view, initialPoints, onChange }: PhotoLineAnalyzerProps) {
  const [points, setPoints] = useState<FacialPoints>(initialPoints ?? {});
  const [dragging, setDragging] = useState<FacialLandmarkId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const relevant = FACIAL_LANDMARKS.filter((l) => l.view === view);
  const pending = relevant.find((l) => !points[l.id])?.id ?? null;
  const labelById = Object.fromEntries(FACIAL_LANDMARKS.map((l) => [l.id, l.label]));

  const setPoint = useCallback(
    (id: FacialLandmarkId, x: number, y: number) => {
      setPoints((prev) => {
        const next = { ...prev, [id]: { x, y } };
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const relativeCoords = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const eLine = view === "perfil" ? computeELine(points) : null;
  const nasolabial = view === "perfil" ? computeNasolabialAngle(points) : null;
  const midline = view === "frente" ? computeMidlineDeviation(points) : null;

  return (
    <div>
      <div
        ref={containerRef}
        onClick={(e) => {
          if (dragging || !pending) return;
          const c = relativeCoords(e);
          if (c) setPoint(pending, c.x, c.y);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const c = relativeCoords(e);
          if (c) setPoint(dragging, c.x, c.y);
        }}
        onPointerUp={() => setDragging(null)}
        className="relative w-full rounded-[10px] overflow-hidden border border-[color:var(--pr-borde)] bg-black select-none"
        style={{ aspectRatio: "3 / 4", cursor: pending ? "crosshair" : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={`Foto de ${view}`} className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          {view === "perfil" && points.PRONASALE && points.SOFT_POGONION ? (
            <line x1={points.PRONASALE.x} y1={points.PRONASALE.y} x2={points.SOFT_POGONION.x} y2={points.SOFT_POGONION.y} stroke="var(--pr-exito)" strokeWidth="0.4" />
          ) : null}
          {view === "frente" && points.GLABELLA && points.MENTON_SOFT ? (
            <line x1={points.GLABELLA.x} y1={points.GLABELLA.y} x2={points.MENTON_SOFT.x} y2={points.MENTON_SOFT.y} stroke="var(--pr-exito)" strokeWidth="0.4" />
          ) : null}
        </svg>
        {(Object.keys(points) as FacialLandmarkId[])
          .filter((id) => relevant.some((l) => l.id === id))
          .map((id) => {
            const p = points[id]!;
            return (
              <button
                key={id}
                type="button"
                aria-label={labelById[id]}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragging(id);
                }}
                // Sobre una foto el punto lleva aro blanco en los dos temas.
                className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full bg-[color:var(--pr-activo)] border-2 border-white"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={labelById[id]}
              />
            );
          })}
      </div>

      <div className="mt-3 text-xs text-[color:var(--pr-texto-3)]">
        {pending ? (
          <>
            Marca: <b className="text-[color:var(--pr-texto-2)]">{labelById[pending]}</b>
          </>
        ) : (
          <span className="text-[color:var(--pr-exito)]">Puntos completos.</span>
        )}
      </div>

      {points && Object.keys(points).length > 0 ? (
        <div className={`${orto.rejilla2} mt-3`} style={{ gap: 6 }}>
          {view === "perfil" ? (
            <>
              <Metric label="Línea E — labio sup." value={eLine?.upperLipPx != null ? `${Math.round(eLine.upperLipPx)} px` : "—"} />
              <Metric label="Línea E — labio inf." value={eLine?.lowerLipPx != null ? `${Math.round(eLine.lowerLipPx)} px` : "—"} />
              <Metric label="Ángulo nasolabial" value={nasolabial != null ? `${nasolabial}°` : "—"} />
            </>
          ) : (
            <Metric label="Desviación línea media" value={midline?.deviationPx != null ? `${Math.round(Math.abs(midline.deviationPx))} px` : "—"} />
          )}
        </div>
      ) : null}

      {Object.keys(points).length > 0 ? (
        <div className="mt-3">
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
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={orto.caja} style={{ padding: "8px 10px" }}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className="text-[14px] font-bold">{value}</div>
    </div>
  );
}

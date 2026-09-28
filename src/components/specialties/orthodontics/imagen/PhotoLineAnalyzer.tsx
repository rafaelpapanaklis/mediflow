"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H5:
// marcar puntos sobre la foto de perfil/frente y ver línea E, ángulo
// nasolabial y línea media en vivo.
//
// Geometría corregida (ws1-t10, H19): antes los puntos se guardaban en %
// de un recuadro 3:4 fijo, pintado con un <svg viewBox="0 0 100 100"
// preserveAspectRatio="none"> — deformaba cualquier medida que no fuera
// puramente horizontal o vertical (mismo defecto que tenía
// CephalometricTracer, ver investigacion-trazado.md §2.3a). Ahora los
// puntos se guardan en px NATURALES de la foto (naturalWidth/naturalHeight)
// y la única conversión a/desde pantalla es `image-coords.ts`, la misma
// cuenta que hace `object-fit: contain` — sin escalar x/y por separado, y
// sin aceptar clics en las franjas negras fuera de la foto.

import { useCallback, useEffect, useRef, useState } from "react";
import { FACIAL_LANDMARKS, type FacialLandmarkId, type FacialPoints } from "@/lib/orthodontics/fotos/landmarks";
import { computeELine, computeMidlineDeviation, computeNasolabialAngle } from "@/lib/orthodontics/fotos/facial-analysis";
import { containerPointToImagePoint, imagePointToContainerPoint, type Size } from "@/lib/orthodontics/fotos/image-coords";
import { Btn } from "../redesign/atoms/Btn";
import orto from "../redesign/orto.module.css";

export interface PhotoLineAnalyzerProps {
  imageUrl: string;
  view: "perfil" | "frente";
  initialPoints?: FacialPoints;
  /** px por mm si hay una calibración conocida — sin ella se muestran proporciones, nunca "px" a secas. */
  pixelsPerMm?: number | null;
  onChange?: (points: FacialPoints, imageSize: Size) => void;
}

export function PhotoLineAnalyzer({ imageUrl, view, initialPoints, pixelsPerMm, onChange }: PhotoLineAnalyzerProps) {
  const [points, setPoints] = useState<FacialPoints>(initialPoints ?? {});
  const [dragging, setDragging] = useState<FacialLandmarkId | null>(null);
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [containerSize, setContainerSize] = useState<Size | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reinicia al cambiar de foto — un análisis viejo sobre una foto nueva no tiene sentido.
  useEffect(() => {
    setPoints(initialPoints ?? {});
    setImageSize(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const relevant = FACIAL_LANDMARKS.filter((l) => l.view === view);
  const pending = relevant.find((l) => !points[l.id])?.id ?? null;
  const labelById = Object.fromEntries(FACIAL_LANDMARKS.map((l) => [l.id, l.label]));
  const ready = imageSize !== null && containerSize !== null;

  const setPoint = useCallback(
    (id: FacialLandmarkId, x: number, y: number) => {
      setPoints((prev) => {
        const next = { ...prev, [id]: { x, y } };
        if (imageSize) onChange?.(next, imageSize);
        return next;
      });
    },
    [onChange, imageSize],
  );

  /** Punto en px NATURALES de la foto a partir de un evento de puntero, o null si cae fuera de la foto (franja negra). */
  const naturalPoint = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !imageSize) return null;
    return containerPointToImagePoint(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      { width: rect.width, height: rect.height },
      imageSize,
    );
  };

  const toScreen = (p: { x: number; y: number }) => {
    if (!imageSize || !containerSize) return { x: 0, y: 0 };
    return imagePointToContainerPoint(p, containerSize, imageSize);
  };

  const eLine = view === "perfil" ? computeELine(points, pixelsPerMm ?? undefined) : null;
  const nasolabial = view === "perfil" ? computeNasolabialAngle(points) : null;
  const midline = view === "frente" ? computeMidlineDeviation(points, pixelsPerMm ?? undefined) : null;

  const lineEndpoints =
    view === "perfil" && points.PRONASALE && points.SOFT_POGONION
      ? [toScreen(points.PRONASALE), toScreen(points.SOFT_POGONION)]
      : view === "frente" && points.GLABELLA && points.MENTON_SOFT
        ? [toScreen(points.GLABELLA), toScreen(points.MENTON_SOFT)]
        : null;

  return (
    <div>
      <div
        ref={containerRef}
        onClick={(e) => {
          if (dragging || !pending || !ready) return;
          const p = naturalPoint(e);
          if (p) setPoint(pending, p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!dragging || !ready) return;
          const p = naturalPoint(e);
          if (p) setPoint(dragging, p.x, p.y);
        }}
        onPointerUp={() => setDragging(null)}
        className="relative w-full rounded-[10px] overflow-hidden border border-[color:var(--pr-borde)] bg-black select-none"
        style={{ aspectRatio: "3 / 4", cursor: pending ? "crosshair" : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Foto de ${view}`}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
          }}
        />
        {containerSize && lineEndpoints ? (
          <svg
            viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <line
              x1={lineEndpoints[0].x}
              y1={lineEndpoints[0].y}
              x2={lineEndpoints[1].x}
              y2={lineEndpoints[1].y}
              stroke="var(--pr-exito)"
              strokeWidth="1.5"
            />
          </svg>
        ) : null}
        {ready
          ? (Object.keys(points) as FacialLandmarkId[])
              .filter((id) => relevant.some((l) => l.id === id))
              .map((id) => {
                const screen = toScreen(points[id]!);
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
                    style={{ left: screen.x, top: screen.y }}
                    title={labelById[id]}
                  />
                );
              })
          : null}
      </div>

      <div className="mt-3 text-xs text-[color:var(--pr-texto-3)]">
        {!ready ? (
          "Cargando foto…"
        ) : pending ? (
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
              <Metric label="Línea E — labio sup." value={formatLinearMetric(eLine?.upperLipMm, eLine?.upperLipRatio)} />
              <Metric label="Línea E — labio inf." value={formatLinearMetric(eLine?.lowerLipMm, eLine?.lowerLipRatio)} />
              <Metric label="Ángulo nasolabial" value={nasolabial != null ? `${nasolabial}°` : "—"} />
            </>
          ) : (
            <Metric label="Desviación línea media" value={formatLinearMetric(midline?.deviationMm, midline?.deviationRatio)} />
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
              if (imageSize) onChange?.({}, imageSize);
            }}
          >
            Reiniciar
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

/**
 * mm si hay calibración; si no, proporción respecto al segmento de
 * referencia (H19: un conteo de px crudo no es una unidad clínica). "±12%
 * de la línea" en vez de "12 px".
 */
function formatLinearMetric(mm: number | null | undefined, ratio: number | null | undefined): string {
  if (mm != null) return `${mm} mm`;
  if (ratio != null) return `${ratio >= 0 ? "+" : ""}${Math.round(ratio * 100)}%`;
  return "—";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={orto.caja} style={{ padding: "8px 10px" }}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className="text-[14px] font-bold">{value}</div>
    </div>
  );
}

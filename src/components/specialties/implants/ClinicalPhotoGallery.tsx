"use client";

/**
 * Galería de fotos clínicas universal por paciente/módulo. Soporta:
 *  - Filtrado por tipo de foto y fase
 *  - Vista en grid con thumbnail, lightbox al click
 *  - Tag visual de stage (Antes/Durante/Después/Control)
 *
 * Diseñada para implantes (set v2 de tipos granulares) pero reusable por
 * otros módulos. Solo client-side; el caller pasa fotos pre-cargadas.
 */

import * as React from "react";
import { Camera, Filter, X } from "lucide-react";
import {
  type ClinicalPhotoStage,
  type ClinicalPhotoType,
  type ClinicalModule,
} from "@/lib/clinical-shared/types";
import {
  clinicalPhotoStageLabel,
  clinicalPhotoTypeLabel,
  isRadiographPhotoType,
  sortPhotosByDateDesc,
} from "@/lib/clinical-shared/photo-gallery";

export interface ClinicalPhotoItem {
  id: string;
  module: ClinicalModule;
  patientId: string;
  toothFdi: number | null;
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
  capturedAt: Date;
  blobUrl: string;
  thumbnailUrl: string | null;
  notes: string | null;
}

export interface ClinicalPhotoGalleryProps {
  photos: readonly ClinicalPhotoItem[];
  /** Filtrar por uno o más tipos. Si vacío muestra todos. */
  initialTypeFilter?: ClinicalPhotoType[];
  /** Etiqueta opcional sobre la galería. */
  title?: string;
  /** Callback al hacer click en una foto (en vez del lightbox interno). */
  onPhotoClick?: (photo: ClinicalPhotoItem) => void;
  /** Modo compacto (más fotos por fila). */
  compact?: boolean;
}

const STAGE_COLOR: Record<ClinicalPhotoStage, string> = {
  pre: "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
  during: "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]",
  post: "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]",
  control: "bg-[var(--color-muted)] text-[var(--color-muted-fg)]",
};

export default function ClinicalPhotoGallery({
  photos,
  initialTypeFilter = [],
  title = "Galería clínica",
  onPhotoClick,
  compact = false,
}: ClinicalPhotoGalleryProps) {
  const [typeFilter, setTypeFilter] = React.useState<ClinicalPhotoType[]>(
    initialTypeFilter,
  );
  const [stageFilter, setStageFilter] = React.useState<ClinicalPhotoStage | null>(
    null,
  );
  const [openId, setOpenId] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    let list = [...photos];
    if (typeFilter.length > 0) {
      list = list.filter((p) => typeFilter.includes(p.photoType));
    }
    if (stageFilter) {
      list = list.filter((p) => p.stage === stageFilter);
    }
    return sortPhotosByDateDesc(list);
  }, [photos, typeFilter, stageFilter]);

  const availableTypes = React.useMemo(() => {
    const set = new Set<ClinicalPhotoType>();
    for (const p of photos) set.add(p.photoType);
    return Array.from(set);
  }, [photos]);

  const opened = openId ? photos.find((p) => p.id === openId) ?? null : null;

  const gridCols = compact
    ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6"
    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <header className="mb-3 flex items-center gap-2">
        <Camera className="h-5 w-5 text-[var(--color-muted-fg)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
        <span className="ml-auto text-xs text-[var(--color-muted-fg)]">
          {filtered.length} de {photos.length}
        </span>
      </header>

      {/* filtros */}
      {availableTypes.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[var(--color-muted-fg)]" aria-hidden />
          {availableTypes.map((t) => {
            const active = typeFilter.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setTypeFilter((prev) =>
                    prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                  )
                }
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]"
                    : "border-[var(--border)] text-[var(--color-muted-fg)] hover:bg-[var(--accent)]"
                }`}
              >
                {clinicalPhotoTypeLabel(t)}
              </button>
            );
          })}
          <span className="mx-2 h-4 w-px bg-[var(--border)]" />
          {(["pre", "during", "post", "control"] as ClinicalPhotoStage[]).map((s) => {
            const active = stageFilter === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setStageFilter(active ? null : s)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]"
                    : "border-[var(--border)] text-[var(--color-muted-fg)] hover:bg-[var(--accent)]"
                }`}
              >
                {clinicalPhotoStageLabel(s)}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-muted-fg)]">
          No hay fotos que coincidan con los filtros.
        </p>
      ) : (
        <ul className={`grid ${gridCols} gap-3`}>
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => (onPhotoClick ? onPhotoClick(p) : setOpenId(p.id))}
                aria-label={`Foto ${clinicalPhotoTypeLabel(p.photoType)} ${
                  p.toothFdi != null ? `diente ${p.toothFdi}` : ""
                }`}
                className="group block w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)] text-left focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <div className="relative aspect-square overflow-hidden bg-[var(--color-muted)]">
                  <img
                    src={p.thumbnailUrl ?? p.blobUrl}
                    alt=""
                    className={`h-full w-full object-cover transition group-hover:scale-105 ${
                      isRadiographPhotoType(p.photoType) ? "grayscale" : ""
                    }`}
                    loading="lazy"
                  />
                  <span
                    className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      STAGE_COLOR[p.stage]
                    }`}
                  >
                    {clinicalPhotoStageLabel(p.stage)}
                  </span>
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-xs font-medium text-[var(--foreground)]">
                    {clinicalPhotoTypeLabel(p.photoType)}
                  </p>
                  <p className="text-[10px] text-[var(--color-muted-fg)]">
                    {formatDate(p.capturedAt)}
                    {p.toothFdi != null ? ` · ${p.toothFdi}` : ""}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* lightbox */}
      {opened && !onPhotoClick && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpenId(null)}
        >
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute right-4 top-4 rounded-full bg-[var(--card)] p-1.5 text-[var(--foreground)]"
            onClick={(e) => {
              e.stopPropagation();
              setOpenId(null);
            }}
          >
            <X className="h-4 w-4" />
          </button>
          <div
            className="max-h-full max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={opened.blobUrl}
              alt=""
              className={`max-h-[85vh] max-w-[90vw] rounded shadow-2xl ${
                isRadiographPhotoType(opened.photoType) ? "grayscale" : ""
              }`}
            />
            {opened.notes && (
              <p className="mt-2 max-w-prose text-sm text-white/90">
                {opened.notes}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

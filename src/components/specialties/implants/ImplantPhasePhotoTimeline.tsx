"use client";

/**
 * Timeline visual de fotos clínicas por fase implantológica.
 *
 * Agrupa las ClinicalPhoto del implante por fase canónica:
 *   pre-quirúrgico → quirúrgico → cicatrización → pilar → corona →
 *   controles
 *
 * Dentro de cada fase, sub-agrupa por stage (antes / durante / después).
 * Útil para ver de un vistazo la evolución completa del caso —
 * comparativos antes/durante/después por fase.
 */

import * as React from "react";
import {
  Compass,
  Stethoscope,
  Heart,
  Scissors,
  Crown,
  Activity,
  Camera,
} from "lucide-react";
import {
  type ClinicalPhotoStage,
  type ClinicalPhotoType,
  type ImplantPhaseKey,
} from "@/lib/clinical-shared/types";
import {
  clinicalPhotoStageLabel,
  clinicalPhotoTypeLabel,
  groupImplantPhotosByPhase,
  groupPhotosByStage,
  isRadiographPhotoType,
} from "@/lib/clinical-shared/photo-gallery";

export interface PhasePhotoItem {
  id: string;
  module: "implants";
  patientId: string;
  toothFdi: number | null;
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
  capturedAt: Date;
  blobUrl: string;
  thumbnailUrl: string | null;
  notes: string | null;
}

const PHASE_ORDER: ImplantPhaseKey[] = [
  "planning",
  "surgical",
  "healing",
  "second_stage",
  "prosthetic",
  "follow_up",
];

const PHASE_ICON: Record<ImplantPhaseKey, typeof Compass> = {
  planning: Compass,
  surgical: Stethoscope,
  healing: Heart,
  second_stage: Scissors,
  prosthetic: Crown,
  follow_up: Activity,
};

const PHASE_LABEL: Record<ImplantPhaseKey, string> = {
  planning: "Pre-quirúrgico",
  surgical: "Cirugía",
  healing: "Cicatrización",
  second_stage: "Pilar (segunda fase)",
  prosthetic: "Corona",
  follow_up: "Controles",
};

const STAGE_ORDER: ClinicalPhotoStage[] = ["pre", "during", "post", "control"];

export interface ImplantPhasePhotoTimelineProps {
  photos: readonly PhasePhotoItem[];
  /** Click sobre una foto (lightbox externo). */
  onPhotoClick?: (p: PhasePhotoItem) => void;
}

export default function ImplantPhasePhotoTimeline({
  photos,
  onPhotoClick,
}: ImplantPhasePhotoTimelineProps) {
  const byPhase = React.useMemo(
    () => groupImplantPhotosByPhase(photos),
    [photos],
  );

  const total = photos.length;

  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <Camera
          className="mx-auto mb-2 h-8 w-8 text-[var(--color-muted-fg)]"
          aria-hidden
        />
        <p className="text-sm text-[var(--color-muted-fg)]">
          Aún no hay fotos clínicas para este implante.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Fotos clínicas por fase"
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <header className="mb-4 flex items-center gap-2">
        <Camera className="h-5 w-5 text-[var(--color-muted-fg)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Fotos por fase
        </h3>
        <span className="ml-auto text-xs text-[var(--color-muted-fg)]">
          {total} foto{total !== 1 ? "s" : ""}
        </span>
      </header>

      <ol className="relative space-y-5 border-l border-[var(--border)] pl-6">
        {PHASE_ORDER.map((phase) => {
          const inPhase = byPhase[phase] ?? [];
          if (inPhase.length === 0) return null;

          const Icon = PHASE_ICON[phase];
          const byStage = groupPhotosByStage(inPhase);

          return (
            <li key={phase} className="relative">
              <span
                aria-hidden
                className="absolute -left-[34px] flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--primary)] bg-[var(--card)] text-[var(--primary)]"
              >
                <Icon className="h-3 w-3" />
              </span>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{PHASE_LABEL[phase]}</h4>
                  <span className="text-xs text-[var(--color-muted-fg)]">
                    {inPhase.length} foto{inPhase.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* sub-agrupación por stage (Antes / Durante / Después / Control) */}
                <div className="space-y-2">
                  {STAGE_ORDER.filter((s) => byStage[s].length > 0).map((s) => (
                    <StageRow
                      key={s}
                      stage={s}
                      photos={byStage[s]}
                      onPhotoClick={onPhotoClick}
                    />
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StageRow({
  stage,
  photos,
  onPhotoClick,
}: {
  stage: ClinicalPhotoStage;
  photos: readonly PhasePhotoItem[];
  onPhotoClick?: (p: PhasePhotoItem) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted-fg)]">
        {clinicalPhotoStageLabel(stage)} · {photos.length}
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {photos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={onPhotoClick ? () => onPhotoClick(p) : undefined}
              aria-label={`Foto ${clinicalPhotoTypeLabel(p.photoType)} ${p.toothFdi ? `diente ${p.toothFdi}` : ""}`}
              className="group block w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <div className="relative aspect-square">
                <img
                  src={p.thumbnailUrl ?? p.blobUrl}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover transition group-hover:scale-105 ${
                    isRadiographPhotoType(p.photoType) ? "grayscale" : ""
                  }`}
                />
              </div>
              <div className="px-1.5 py-1">
                <p className="truncate text-[10px] font-medium text-[var(--foreground)]">
                  {clinicalPhotoTypeLabel(p.photoType)}
                </p>
                <p className="text-[9px] text-[var(--color-muted-fg)]">
                  {p.capturedAt.toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "short",
                  })}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

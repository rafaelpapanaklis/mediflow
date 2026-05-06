"use client";

/**
 * Comparativo radiográfico de oseointegración. Renderiza lado a lado
 * radiografías peri-implantares de momentos clave:
 *   - RX inmediata post-cirugía
 *   - Control 4 meses
 *   - Control 12 meses
 *   - Control anual (último)
 *
 * Sobre cada panel: pérdida ósea observada vs criterio Albrektsson 1986
 * (1.5 mm año 1, <0.2 mm/año después). Barra visual con código de
 * color (verde dentro de criterio, rojo si excede).
 *
 * Crítico clínicamente: detección temprana de pérdida ósea peri-implantar.
 */

import * as React from "react";
import { AlertTriangle, CheckCircle2, ImageOff, Ruler } from "lucide-react";
import {
  evaluateAlbrektsson,
  yearsBetween,
} from "@/lib/implants/albrektsson-success";

export type RadiographMilestone =
  | "POST_OP"
  | "CONTROL_4M"
  | "CONTROL_12M"
  | "ANNUAL";

interface RadiographItem {
  id: string;
  milestone: RadiographMilestone;
  takenAt: Date;
  url: string;
  /** Pérdida ósea radiográfica acumulada en mm, si fue medida. */
  boneLossMm: number | null;
  notes: string | null;
}

export interface ImplantOsseointegrationCompareProps {
  placedAt: Date;
  /** Lista no ordenada — el componente la ordena por milestone. */
  radiographs: readonly RadiographItem[];
  /** Acción opcional al click sobre una radiografía (ej. abrir lightbox). */
  onRadiographClick?: (r: RadiographItem) => void;
}

const MILESTONE_LABEL: Record<RadiographMilestone, string> = {
  POST_OP: "Post-cirugía (inmediata)",
  CONTROL_4M: "Control 4 meses",
  CONTROL_12M: "Control 12 meses",
  ANNUAL: "Control anual (último)",
};

const MILESTONE_ORDER: RadiographMilestone[] = [
  "POST_OP",
  "CONTROL_4M",
  "CONTROL_12M",
  "ANNUAL",
];

function fmt(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ImplantOsseointegrationCompare({
  placedAt,
  radiographs,
  onRadiographClick,
}: ImplantOsseointegrationCompareProps) {
  // Para cada milestone, busca la RX correspondiente (la más reciente si hay
  // varias del mismo milestone)
  const byMilestone = React.useMemo(() => {
    const out: Partial<Record<RadiographMilestone, RadiographItem>> = {};
    for (const r of radiographs) {
      const cur = out[r.milestone];
      if (!cur || cur.takenAt < r.takenAt) {
        out[r.milestone] = r;
      }
    }
    return out;
  }, [radiographs]);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <header className="mb-4 flex items-center gap-2">
        <Ruler className="h-5 w-5 text-[var(--color-muted-fg)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Comparativo radiográfico de oseointegración
        </h3>
        <span className="ml-auto text-xs text-[var(--color-muted-fg)]">
          Albrektsson 1986
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {MILESTONE_ORDER.map((m) => {
          const r = byMilestone[m];
          return (
            <RadiographPanel
              key={m}
              label={MILESTONE_LABEL[m]}
              placedAt={placedAt}
              radiograph={r}
              onClick={onRadiographClick}
            />
          );
        })}
      </div>
    </section>
  );
}

function RadiographPanel({
  label,
  placedAt,
  radiograph,
  onClick,
}: {
  label: string;
  placedAt: Date;
  radiograph: RadiographItem | undefined;
  onClick?: (r: RadiographItem) => void;
}) {
  if (!radiograph) {
    return (
      <div className="flex h-full flex-col rounded-md border border-dashed border-[var(--border)] bg-[var(--background)] p-3">
        <p className="text-xs font-medium text-[var(--foreground)]">{label}</p>
        <div className="mt-2 flex flex-1 flex-col items-center justify-center py-8 text-[var(--color-muted-fg)]">
          <ImageOff className="mb-1 h-6 w-6" aria-hidden />
          <span className="text-xs">Pendiente</span>
        </div>
      </div>
    );
  }

  const years = yearsBetween(placedAt, radiograph.takenAt);
  const evaluation =
    radiograph.boneLossMm != null
      ? evaluateAlbrektsson(radiograph.boneLossMm, years)
      : null;

  return (
    <div className="flex h-full flex-col rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-xs font-medium text-[var(--foreground)]">{label}</p>
        <span className="text-[10px] text-[var(--color-muted-fg)]">
          {fmt(radiograph.takenAt)}
        </span>
      </div>

      <button
        type="button"
        onClick={onClick ? () => onClick(radiograph) : undefined}
        aria-label="Ver radiografía ampliada"
        className="group relative aspect-square overflow-hidden rounded border border-[var(--border)] bg-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        disabled={!onClick}
      >
        <img
          src={radiograph.url}
          alt={`Radiografía ${label}`}
          className="h-full w-full object-cover grayscale transition group-hover:scale-105"
          loading="lazy"
        />
      </button>

      {evaluation ? (
        <BoneLossBar evaluation={evaluation} />
      ) : (
        <p className="mt-2 text-[10px] text-[var(--color-muted-fg)]">
          Pérdida ósea no medida
        </p>
      )}

      {radiograph.notes ? (
        <p className="mt-1 text-[10px] text-[var(--color-muted-fg)]">
          {radiograph.notes}
        </p>
      ) : null}
    </div>
  );
}

function BoneLossBar({
  evaluation,
}: {
  evaluation: ReturnType<typeof evaluateAlbrektsson>;
}) {
  // Escala dinámica: hasta el doble del esperado o 4mm, lo que sea mayor
  const scale = Math.max(evaluation.expectedMaxBoneLossMm * 2, 4);
  const observedPct = Math.min(
    100,
    (evaluation.observedBoneLossMm / scale) * 100,
  );
  const expectedPct = Math.min(
    100,
    (evaluation.expectedMaxBoneLossMm / scale) * 100,
  );

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--color-muted-fg)]">Pérdida ósea</span>
        <span className="font-semibold">
          {evaluation.observedBoneLossMm.toFixed(1)} mm
        </span>
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded bg-[var(--color-muted)]"
        role="progressbar"
        aria-valuenow={evaluation.observedBoneLossMm}
        aria-valuemax={scale}
      >
        {/* Marcador esperado (línea vertical) */}
        <div
          className="absolute top-0 h-full w-0.5 bg-[var(--color-muted-fg)]"
          style={{ left: `${expectedPct}%` }}
          aria-hidden
        />
        {/* Barra observada */}
        <div
          className={`h-full ${
            evaluation.meetsCriteria
              ? "bg-[var(--color-success-fg)]"
              : "bg-[var(--color-danger-fg)]"
          }`}
          style={{ width: `${observedPct}%` }}
        />
      </div>
      <div className="flex items-center gap-1 text-[10px]">
        {evaluation.meetsCriteria ? (
          <>
            <CheckCircle2
              className="h-3 w-3 text-[var(--color-success-fg)]"
              aria-hidden
            />
            <span>
              Dentro de criterio (≤{evaluation.expectedMaxBoneLossMm.toFixed(1)} mm
              a {evaluation.yearsSincePlacement.toFixed(1)} años)
            </span>
          </>
        ) : (
          <>
            <AlertTriangle
              className="h-3 w-3 text-[var(--color-danger-fg)]"
              aria-hidden
            />
            <span>
              Excede criterio (esperado ≤
              {evaluation.expectedMaxBoneLossMm.toFixed(1)} mm)
            </span>
          </>
        )}
      </div>
    </div>
  );
}

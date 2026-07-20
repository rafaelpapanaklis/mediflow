"use client";
// Clinical-shared — comparador antes/después con slider (clip-path), variante
// nueva para el tab "Fotos clínicas" (módulo general). Inspirado en
// specialties/orthodontics/photos/PhotoCompareSlider SIN modificar aquel:
// aquí se compara cualquier par de ClinicalPhotoDTO elegido por el usuario
// (A/B), con drag directo sobre la imagen además del range input.

import { useMemo, useRef, useState } from "react";
import type { ClinicalPhotoDTO } from "@/lib/clinical-shared/photos/types";
import {
  GENERAL_PHOTO_TYPE_LABELS,
  STAGE_LABELS,
  type GeneralPhotoType,
} from "@/lib/clinical-shared/photos/types";

export interface PhotoCompareSliderProps {
  photos: ClinicalPhotoDTO[];
  /** Etiquetas opcionales (el caller puede pasar t()); defaults en ES. */
  labels?: {
    sideA?: string;
    sideB?: string;
    needTwo?: string;
    sliderAria?: string;
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function typeLabel(p: ClinicalPhotoDTO): string {
  return (
    GENERAL_PHOTO_TYPE_LABELS[p.photoType as GeneralPhotoType] ??
    (p.photoType === "other" ? "Otra" : p.photoType)
  );
}

function optionLabel(p: ClinicalPhotoDTO): string {
  return `${fmtDate(p.capturedAt)} · ${STAGE_LABELS[p.stage]} · ${typeLabel(p)}`;
}

export function PhotoCompareSlider({ photos, labels }: PhotoCompareSliderProps) {
  const sideALabel = labels?.sideA ?? "Antes";
  const sideBLabel = labels?.sideB ?? "Después";

  // Orden cronológico ascendente: A default = primera "pre" (o la más
  // antigua); B default = última "post"/"control" (o la más reciente).
  const sorted = useMemo(
    () =>
      [...photos].sort(
        (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      ),
    [photos],
  );
  const defaultA = sorted.find((p) => p.stage === "pre") ?? sorted[0];
  const defaultBCandidates = [...sorted].reverse();
  const defaultB =
    defaultBCandidates.find((p) => (p.stage === "post" || p.stage === "control") && p.id !== defaultA?.id) ??
    sorted[sorted.length - 1];

  const [leftId, setLeftId] = useState<string>(defaultA?.id ?? "");
  const [rightId, setRightId] = useState<string>(defaultB?.id ?? "");
  const [splitPct, setSplitPct] = useState(50);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const left = sorted.find((p) => p.id === leftId) ?? defaultA;
  const right = sorted.find((p) => p.id === rightId) ?? defaultB;

  if (sorted.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center text-xs text-muted-foreground">
        {labels?.needTwo ?? "Se necesitan al menos 2 fotos para comparar."}
      </div>
    );
  }

  const pctFromPointer = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    setSplitPct(Math.min(100, Math.max(0, pct)));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PaneSelect
          label={sideALabel}
          tone="a"
          value={left?.id ?? ""}
          all={sorted}
          onChange={setLeftId}
        />
        <PaneSelect
          label={sideBLabel}
          tone="b"
          value={right?.id ?? ""}
          all={sorted}
          onChange={setRightId}
        />
      </div>

      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-xl border border-border bg-black touch-none select-none"
        style={{ aspectRatio: "4 / 3", cursor: "ew-resize" }}
        onPointerDown={(e) => {
          draggingRef.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          pctFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) pctFromPointer(e.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {left ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={left.blobUrl}
            alt={`${sideALabel} · ${typeLabel(left)}`}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        ) : null}
        {right ? (
          <div
            className="absolute inset-0"
            style={{ clipPath: `inset(0 0 0 ${splitPct}%)` }}
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={right.blobUrl}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        ) : null}

        {/* Divisor + handle circular (pasada v3 — agarradera visible). */}
        <div
          aria-hidden
          className="absolute top-0 bottom-0"
          style={{
            left: `${splitPct}%`,
            width: 2,
            background: "#fff",
            boxShadow: "0 0 8px rgba(0,0,0,0.6)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white shadow-[var(--shadow-3)]"
          style={{
            left: `${splitPct}%`,
            top: "50%",
            background: "var(--brand-grad)",
            border: "2px solid #fff",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 7-5 5 5 5" />
            <path d="m15 7 5 5-5 5" />
          </svg>
        </div>

        {/* Etiquetas overlay */}
        {left ? (
          <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
            {sideALabel} · {fmtDate(left.capturedAt)}
          </span>
        ) : null}
        {right ? (
          <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
            {sideBLabel} · {fmtDate(right.capturedAt)}
          </span>
        ) : null}
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={splitPct}
        onChange={(e) => setSplitPct(Number(e.target.value))}
        aria-label={labels?.sliderAria ?? "Posición del comparador antes-después"}
        className="w-full accent-[var(--brand)]"
      />
    </div>
  );
}

function PaneSelect(props: {
  label: string;
  tone: "a" | "b";
  value: string;
  all: ClinicalPhotoDTO[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          props.tone === "a"
            ? "bg-[var(--bg-elev-2)] text-[var(--text-2)]"
            : "bg-[var(--brand-soft)] text-[var(--brand)]"
        }`}
      >
        {props.label}
      </span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-8 w-full min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-soft)] focus:border-[var(--border-brand)]"
      >
        {props.all.map((p) => (
          <option key={p.id} value={p.id}>
            {optionLabel(p)}
          </option>
        ))}
      </select>
    </label>
  );
}

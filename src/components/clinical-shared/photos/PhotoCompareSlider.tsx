"use client";
// Clinical-shared — comparador antes/después del tab "Fotos clínicas",
// replicando el prototipo de la ficha v3 (Ficha Paciente DaleControl.dc.html):
// selector A (chip ámbar) / B (chip verde) con botón de swap, modo Deslizador
// (clip-path + handle circular blanco con chevrons violeta) o Lado a lado.
// No toca el PhotoCompareSlider de ortodoncia. Solo tokens — cero hex crudos.

import { useMemo, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { ClinicalPhotoDTO } from "@/lib/clinical-shared/photos/types";
import {
  GENERAL_PHOTO_TYPE_LABELS,
  STAGE_LABELS,
  type GeneralPhotoType,
} from "@/lib/clinical-shared/photos/types";

export interface PhotoCompareSliderProps {
  photos: ClinicalPhotoDTO[];
  /** "slider" = deslizador con clip-path · "side" = lado a lado. */
  mode: "slider" | "side";
  labels?: {
    needTwo?: string;
    sliderAria?: string;
    swapAria?: string;
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

/** Etiqueta del overlay dentro de la imagen: "Antes · 12 mar 2026". */
function overlayLabel(p: ClinicalPhotoDTO): string {
  return `${STAGE_LABELS[p.stage]} · ${fmtDate(p.capturedAt)}`;
}

export function PhotoCompareSlider({ photos, mode, labels }: PhotoCompareSliderProps) {
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
    defaultBCandidates.find(
      (p) => (p.stage === "post" || p.stage === "control") && p.id !== defaultA?.id,
    ) ?? sorted[sorted.length - 1];

  const [leftId, setLeftId] = useState<string>(defaultA?.id ?? "");
  const [rightId, setRightId] = useState<string>(defaultB?.id ?? "");
  const [splitPct, setSplitPct] = useState(50);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const left = sorted.find((p) => p.id === leftId) ?? defaultA;
  const right = sorted.find((p) => p.id === rightId) ?? defaultB;

  const pctFromPointer = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    setSplitPct(Math.min(100, Math.max(0, pct)));
  };

  const selectCls =
    "h-[34px] min-w-0 flex-1 rounded-[10px] border border-border bg-card px-2.5 text-xs font-semibold text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-soft)] focus:border-[var(--border-brand)]";

  return (
    <div className="flex flex-col gap-3">
      {/* Selectores A (ámbar) / B (verde) + swap — patrón del prototipo. */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span
          className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-[7px] bg-[var(--warning-soft)] text-[11px] font-extrabold text-[var(--warning-strong)]"
          aria-hidden
        >
          A
        </span>
        <select
          value={left?.id ?? ""}
          onChange={(e) => setLeftId(e.target.value)}
          className={`${selectCls} min-w-[160px]`}
          aria-label="Foto A"
        >
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {optionLabel(p)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            const l = left?.id ?? "";
            setLeftId(right?.id ?? "");
            setRightId(l);
          }}
          title={labels?.swapAria ?? "Intercambiar A y B"}
          aria-label={labels?.swapAria ?? "Intercambiar A y B"}
          className="grid h-[34px] w-[34px] flex-shrink-0 place-items-center rounded-[10px] border border-border bg-card text-muted-foreground transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
        >
          <ArrowLeftRight size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <span
          className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-[7px] bg-[var(--success-soft)] text-[11px] font-extrabold text-[var(--success-strong)]"
          aria-hidden
        >
          B
        </span>
        <select
          value={right?.id ?? ""}
          onChange={(e) => setRightId(e.target.value)}
          className={`${selectCls} min-w-[160px]`}
          aria-label="Foto B"
        >
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {optionLabel(p)}
            </option>
          ))}
        </select>
      </div>

      {sorted.length < 2 ? (
        /* 0-1 fotos: la card NO colapsa — el aviso va dentro del área de imagen. */
        <div className="flex h-[280px] w-full items-center justify-center rounded-xl border border-dashed border-border bg-[var(--bg-elev-2)] px-5 text-center text-xs font-medium text-muted-foreground sm:h-[360px] lg:h-[430px]">
          {labels?.needTwo ?? "Se necesitan al menos 2 fotos para comparar."}
        </div>
      ) : mode === "slider" ? (
        <>
          <div
            ref={frameRef}
            className="relative h-[280px] w-full touch-none select-none overflow-hidden rounded-xl border border-border bg-black sm:h-[360px] lg:h-[430px]"
            style={{ cursor: "ew-resize" }}
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
                alt={`A · ${overlayLabel(left)}`}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            ) : null}
            {right ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{ clipPath: `inset(0 0 0 ${splitPct}%)` }}
                aria-hidden
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={right.blobUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              </div>
            ) : null}

            {/* Divisor + handle circular blanco con chevrons violeta. */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,0.5)]"
              style={{ left: `${splitPct}%` }}
            >
              <span className="absolute left-1/2 top-1/2 grid h-[38px] w-[38px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[var(--brand)] shadow-[0_4px_14px_rgba(0,0,0,0.35)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m9 7-5 5 5 5" />
                  <path d="m15 7 5 5-5 5" />
                </svg>
              </span>
            </div>

            {left ? (
              <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-white">
                A · {overlayLabel(left)}
              </span>
            ) : null}
            {right ? (
              <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-white">
                B · {overlayLabel(right)}
              </span>
            ) : null}
          </div>

          {/* Range accesible (teclado/lector) — el drag es el gesto primario. */}
          <input
            type="range"
            min={0}
            max={100}
            value={splitPct}
            onChange={(e) => setSplitPct(Number(e.target.value))}
            aria-label={labels?.sliderAria ?? "Posición del comparador antes-después"}
            className="w-full accent-[var(--brand)]"
          />
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { tag: "A", photo: left },
            { tag: "B", photo: right },
          ].map(({ tag, photo }) => (
            <div
              key={tag}
              className="relative aspect-[16/11] overflow-hidden rounded-xl border border-border bg-black"
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.blobUrl}
                  alt={`${tag} · ${overlayLabel(photo)}`}
                  className="absolute inset-0 h-full w-full object-cover"
                  draggable={false}
                />
              ) : null}
              {photo ? (
                <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-white">
                  {tag} · {overlayLabel(photo)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

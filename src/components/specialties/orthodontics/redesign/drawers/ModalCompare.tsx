"use client";
// Modal Compare T0 vs actual.
// 2 columnas con thumbnails de 10 vistas. Permite alternar T0 vs T1, T2,
// CONTROL · genera PDF antes/después en debond (M5 visual proof).

import { useState } from "react";
import { Camera, Download, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { PHOTO_SLOTS } from "../sections/PhotoSlotIcon";
import type { PhotoStage } from "../sections/SectionPhotos";
import { fmtDate } from "../atoms/format";
import orto from "../orto.module.css";

export interface CompareSet {
  stage: PhotoStage;
  takenAt: string | null;
  /** Map slotId → URL (null si no se subió). */
  photos: Record<string, string | null>;
}

export interface ModalCompareProps {
  setT0: CompareSet | null;
  setRight: CompareSet | null;
  /** Stages disponibles del lado derecho (T1/T2/CONTROL). */
  availableRightStages: PhotoStage[];
  onSelectRight?: (stage: PhotoStage) => void;
  onGeneratePdf?: () => void;
  onClose: () => void;
}

export function ModalCompare(props: ModalCompareProps) {
  const [stage, setStage] = useState<PhotoStage>(
    (props.setRight?.stage ?? "T1") as PhotoStage,
  );

  return (
    <>
      <div
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <div
        className={orto.ventanaMarco}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-compare-title"
      >
        <div className="bg-[color:var(--pr-tarjeta)] rounded-[14px] shadow-xl border border-[color:var(--pr-borde)] w-full max-w-5xl pointer-events-auto max-h-[90vh] flex flex-col">
          <header className={orto.cajonCabeza}>
            <div>
              <div className={orto.cajonCeja}>
                M5 · Visual proof
              </div>
              <h3
                id="modal-compare-title"
                className="text-[17px] font-semibold text-[color:var(--pr-texto)]"
              >
                Comparativa antes / actual
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Cerrar"
              className={orto.botonIcono}
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>

          <div className="px-5 py-3 border-b border-[color:var(--pr-borde-suave)] flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[color:var(--pr-texto-3)]">
              Comparar T0 vs:
            </span>
            {(["T1", "T2", "CONTROL"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStage(s);
                  props.onSelectRight?.(s);
                }}
                disabled={!props.availableRightStages.includes(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  stage === s
                    ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)] text-[color:var(--orto-violeta)] font-medium"
                    : "border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)]"
                }`}
              >
                {s}
              </button>
            ))}
            <div className="ml-auto">
              {props.onGeneratePdf ? (
                <Btn
                  variant="emerald"
                  size="sm"
                  icon={<Download className="w-3.5 h-3.5" aria-hidden />}
                  onClick={props.onGeneratePdf}
                >
                  Generar PDF
                </Btn>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            <CompareColumn
              label="T0 · inicial"
              date={props.setT0?.takenAt ?? null}
              photos={props.setT0?.photos ?? {}}
              accent="slate"
            />
            <CompareColumn
              label={
                stage === "T1" ? "T1 · mes 12" : stage === "T2" ? "T2 · final" : "Control"
              }
              date={props.setRight?.takenAt ?? null}
              photos={props.setRight?.photos ?? {}}
              accent="violet"
            />
          </div>
        </div>
      </div>
    </>
  );
}

function CompareColumn({
  label,
  date,
  photos,
  accent,
}: {
  label: string;
  date: string | null;
  photos: Record<string, string | null>;
  accent: "slate" | "violet";
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Pill color={accent === "violet" ? "violet" : "slate"} size="xs">
          {label}
        </Pill>
        {date ? (
          <span className="text-[11px] text-[color:var(--pr-texto-3)] tabular-nums">
            {fmtDate(date)}
          </span>
        ) : (
          <span className="text-[11px] text-[color:var(--pr-texto-3)] italic">sin fecha</span>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
        {PHOTO_SLOTS.map((slot) => {
          const url = photos[slot.id];
          return (
            <div
              key={slot.id}
              className="aspect-square rounded-[8px] border border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] flex items-center justify-center overflow-hidden"
              title={slot.label}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={slot.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Camera
                  className="w-4 h-4 text-[color:var(--pr-texto-3)]"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

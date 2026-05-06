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
        className="fixed inset-0 bg-slate-900/60 z-40 dark:bg-slate-950/80"
        onClick={props.onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-compare-title"
      >
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-5xl pointer-events-auto max-h-[90vh] flex flex-col dark:bg-slate-900 dark:border-slate-800">
          <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between dark:border-slate-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
                M5 · Visual proof
              </div>
              <h3
                id="modal-compare-title"
                className="text-lg font-semibold text-slate-900 dark:text-slate-100"
              >
                Comparativa antes / actual
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Cerrar"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>

          <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
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
                    ? "border-violet-500 bg-violet-50 text-violet-900 font-medium dark:bg-violet-900/20"
                    : "border-slate-200 bg-white text-slate-600 dark:bg-slate-900 dark:border-slate-700"
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

          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
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
          <span className="text-[10px] text-slate-400 font-mono dark:text-slate-500">
            {fmtDate(date)}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 italic">sin fecha</span>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
        {PHOTO_SLOTS.map((slot) => {
          const url = photos[slot.id];
          return (
            <div
              key={slot.id}
              className="aspect-square rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden dark:bg-slate-800 dark:border-slate-700"
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
                  className="w-4 h-4 text-slate-300 dark:text-slate-600"
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

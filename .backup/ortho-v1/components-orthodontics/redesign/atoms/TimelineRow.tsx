"use client";
// Atom: TimelineRow — fila clickable que representa una cita del Treatment
// Card history. Renderiza badge con número de cita, fecha, fase, mes,
// wire from→to, elasticos, IPR, broken brackets, hygiene y miniatura
// indicador de foto.

import { Camera, ChevronRight } from "lucide-react";
import type { TreatmentCardDTO } from "../types";
import { ELASTIC_CLASS_LABELS, GINGIVITIS_LABELS, PHASE_LABELS } from "../types";
import { fmtDate, clinicalSeverityColor } from "./format";
import { Pill } from "./Pill";

export interface TimelineRowProps {
  card: TreatmentCardDTO;
  isLast?: boolean;
  onClick?: () => void;
}

export function TimelineRow({ card, isLast = false, onClick }: TimelineRowProps) {
  const wireFromLabel = card.wireFrom ? wireLabel(card.wireFrom) : "—";
  const wireToLabel = card.wireTo ? wireLabel(card.wireTo) : null;
  const wireChange = wireToLabel != null && wireFromLabel !== wireToLabel;

  const elasticsSummary =
    card.elastics.length === 0
      ? "—"
      : card.elastics
          .map((e) => `${ELASTIC_CLASS_LABELS[e.elasticClass]} ${e.config}`)
          .join(" · ");

  const iprDone = card.iprPoints.filter((p) => p.done).length;
  const broken = card.brokenBrackets.length;

  const plaque = card.hygiene.plaquePct;
  const plaqueColor = plaque != null ? clinicalSeverityColor(plaque) : "emerald";

  return (
    <div className="relative pl-10 pr-2">
      {!isLast ? (
        <div
          className="absolute left-4 top-10 bottom-0 w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden
        />
      ) : null}
      <div
        className="absolute left-2 top-3.5 w-5 h-5 rounded-full bg-white border-2 border-violet-500 flex items-center justify-center dark:bg-slate-900"
        aria-hidden
      >
        <span className="text-[10px] font-mono font-bold text-violet-700 dark:text-violet-300">
          {card.cardNumber}
        </span>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left bg-white hover:bg-slate-50 border border-slate-200 hover:border-violet-300 rounded-lg p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-300 dark:bg-slate-900 dark:hover:bg-slate-800/60 dark:border-slate-800 dark:hover:border-violet-700"
        aria-label={`Cita ${card.cardNumber} del ${fmtDate(card.visitDate)} — ${PHASE_LABELS[card.phaseKey]}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Cita #{card.cardNumber}
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {fmtDate(card.visitDate)}
              </span>
              <Pill color="violet" size="xs">
                {PHASE_LABELS[card.phaseKey]}
              </Pill>
              <span className="text-[10px] text-slate-400 font-mono dark:text-slate-500">
                mes {card.monthAt.toFixed(1)}
              </span>
              {card.status === "DRAFT" ? (
                <Pill color="amber" size="xs">
                  Borrador
                </Pill>
              ) : null}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Wire
                </div>
                <div className="text-xs text-slate-700 font-mono mt-0.5 dark:text-slate-300">
                  {wireChange ? (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">{wireFromLabel}</span>
                      {" → "}
                      <span className="text-violet-700 font-semibold dark:text-violet-300">
                        {wireToLabel}
                      </span>
                    </>
                  ) : (
                    <span>{wireToLabel ?? wireFromLabel}</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Elásticos
                </div>
                <div className="text-xs text-slate-700 mt-0.5 truncate dark:text-slate-300">
                  {elasticsSummary}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  IPR / brackets
                </div>
                <div className="text-xs text-slate-700 mt-0.5 dark:text-slate-300">
                  {iprDone > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 mr-2">
                      +{iprDone} IPR
                    </span>
                  ) : null}
                  {broken > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400">
                      {broken} re-bond
                    </span>
                  ) : null}
                  {iprDone === 0 && broken === 0 ? "—" : null}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Higiene · placa
                </div>
                <div className="text-xs mt-0.5">
                  {plaque != null ? (
                    <span
                      className={`font-mono font-semibold ${
                        plaqueColor === "emerald"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : plaqueColor === "amber"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {plaque}%
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                  {card.hygiene.gingivitis ? (
                    <span className="text-slate-500 ml-1 dark:text-slate-400">
                      · {GINGIVITIS_LABELS[card.hygiene.gingivitis]}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {card.soap.p ? (
              <div className="mt-2 text-xs text-slate-600 line-clamp-1 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">P:</span>{" "}
                {card.soap.p}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {card.hasProgressPhoto ? (
              <Pill color="emerald" size="xs">
                <Camera className="w-3 h-3" aria-hidden /> Foto
              </Pill>
            ) : null}
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              {card.durationMin} min
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />
          </div>
        </div>
      </button>
    </div>
  );
}

function wireLabel(wire: { gauge: string; material: string }): string {
  const matLabel: Record<string, string> = {
    NITI: "NiTi",
    SS: "SS",
    TMA: "TMA",
    BETA_TITANIUM: "β-Ti",
  };
  const m = matLabel[wire.material] ?? wire.material;
  return `${m} ${wire.gauge}`;
}

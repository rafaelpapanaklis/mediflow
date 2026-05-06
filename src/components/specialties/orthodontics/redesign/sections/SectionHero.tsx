"use client";
// Sección A — Hero ortodóntico.
//
// Cubre los dos estados:
//   1. Sin tratamiento activo (status no-iniciado): empty state con CTA wizard.
//   2. En tratamiento: status chip + 4 mini-stats + progress bar mes X/Y +
//      timeline visual de fases + botón "Iniciar cita de control".

import { Plus, Pencil, Sparkles, Layers } from "lucide-react";
import { Btn, Card, StatChip, fmtDate, fmtPct } from "../atoms";
import { Pill } from "../atoms/Pill";
import {
  APPLIANCE_SLOT_LABELS,
  PHASE_LABELS,
  PHASE_ORDER,
  type OrthoTreatmentDTO,
} from "../types";

export interface SectionHeroProps {
  treatment: OrthoTreatmentDTO;
  hasUpcomingControlToday?: boolean;
  onStartTreatment?: () => void;
  onEditPlan?: () => void;
  onStartControl?: () => void;
}

export function SectionHero(props: SectionHeroProps) {
  const t = props.treatment;

  if (t.status === "no-iniciado") {
    return <HeroEmptyState onStart={props.onStartTreatment} />;
  }

  const monthsArr = Array.from({ length: Math.max(1, t.monthTotal) }, (_, i) => i + 1);
  const progressPct =
    t.monthTotal > 0 ? Math.min(100, Math.round((t.monthCurrent / t.monthTotal) * 100)) : 0;
  const applianceLabel = t.appliance.prescriptionSlot
    ? APPLIANCE_SLOT_LABELS[t.appliance.prescriptionSlot]
    : "Sin definir";
  const wireLabel = t.wireCurrent
    ? `${formatWireLabel(t.wireCurrent)}`
    : "Sin wire activo";
  const elasticTone =
    t.elasticsCompliancePct >= 85 ? "emerald" : t.elasticsCompliancePct >= 70 ? "amber" : "rose";

  return (
    <Card
      id="hero"
      eyebrow="Tratamiento ortodóntico activo"
      title={
        <>
          Mes {t.monthCurrent} de {t.monthTotal}
          {t.phase ? (
            <span className="text-slate-500 font-normal dark:text-slate-400">
              · Fase {PHASE_LABELS[t.phase]}
            </span>
          ) : null}
        </>
      }
      accent="violet"
      action={
        <div className="flex gap-2">
          {props.onEditPlan ? (
            <Btn variant="secondary" size="sm" icon={<Pencil className="w-3.5 h-3.5" aria-hidden />} onClick={props.onEditPlan}>
              Editar plan
            </Btn>
          ) : null}
          {props.onStartControl ? (
            <Btn
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onStartControl}
            >
              {props.hasUpcomingControlToday ? "Iniciar cita de control" : "Nueva cita"}
            </Btn>
          ) : null}
        </div>
      }
    >
      <div className="px-6 py-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <StatChip
            label="Aparatología"
            value={applianceLabel}
            sub={t.appliance.type ?? "—"}
          />
          <StatChip
            label="Wire actual"
            value={wireLabel}
            sub={t.wireCurrent?.purpose ?? "—"}
          />
          <StatChip
            label="Asistencia"
            value={fmtPct(t.attendancePct)}
            sub="últimos 6 meses"
          />
          <StatChip
            label="Compliance elásticos"
            value={fmtPct(t.elasticsCompliancePct)}
            sub={t.wireCurrent ? "uso 22 h/día" : "no aplica"}
            delta={
              t.elasticsCompliancePct < 80 ? (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" aria-hidden /> alerta IA
                </span>
              ) : undefined
            }
            deltaColor={elasticTone === "rose" ? "rose" : elasticTone === "amber" ? "amber" : "emerald"}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Línea de tiempo · {fmtDate(t.startDate)} → {fmtDate(t.estimatedEndDate)}
            </div>
            <div className="text-xs font-mono text-slate-700 dark:text-slate-300">
              {progressPct}%
            </div>
          </div>
          <div
            className="relative h-8 bg-slate-50 border border-slate-200 rounded-md overflow-hidden dark:bg-slate-800/40 dark:border-slate-700"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Mes ${t.monthCurrent} de ${t.monthTotal}`}
          >
            <div
              className="absolute inset-y-0 left-0 bg-violet-100 border-r border-violet-300 dark:bg-violet-900/30 dark:border-violet-700"
              style={{ width: `${progressPct}%` }}
            />
            <div className="absolute inset-0 flex">
              {monthsArr.map((m) => {
                const showLabel = m % 3 === 0 || m === 1 || m === t.monthTotal;
                return (
                  <div
                    key={m}
                    className={`flex-1 border-r border-slate-200/60 flex items-center justify-center text-[9px] dark:border-slate-700/40 ${
                      m <= t.monthCurrent
                        ? "text-violet-700 font-semibold dark:text-violet-300"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {showLabel ? `${m}m` : ""}
                  </div>
                );
              })}
            </div>
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-violet-600"
              style={{ left: `${progressPct}%` }}
              aria-hidden
            />
          </div>
          <div className="mt-2 flex gap-2 flex-wrap">
            {PHASE_ORDER.map((ph) => (
              <Pill
                key={ph}
                color={ph === t.phase ? "violet" : "slate"}
                size="xs"
              >
                {PHASE_LABELS[ph]}
              </Pill>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroEmptyState({ onStart }: { onStart?: () => void }) {
  return (
    <Card id="hero" accent="violet" eyebrow="Ortodoncia">
      <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center dark:bg-violet-900/30 dark:text-violet-300">
          <Layers className="w-7 h-7" aria-hidden />
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Sin tratamiento ortodóntico activo
        </h3>
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
          Inicia el wizard de diagnóstico ortodóntico para evaluar Angle, mordida,
          apiñamiento y planear la aparatología.
        </p>
        {onStart ? (
          <Btn variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden />} onClick={onStart}>
            Iniciar tratamiento ortodóntico
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}

function formatWireLabel(wire: { gauge: string; material: string }): string {
  const matLabel: Record<string, string> = {
    NITI: "NiTi",
    SS: "SS",
    TMA: "TMA",
    BETA_TITANIUM: "β-Ti",
  };
  const m = matLabel[wire.material] ?? wire.material;
  return `${m} ${wire.gauge}`;
}

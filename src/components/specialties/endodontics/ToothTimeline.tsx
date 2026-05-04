"use client";
// Endodontics — ToothTimeline (sección 3, abajo). Spec §6.6

import {
  Activity, Beaker, CalendarCheck, CalendarClock,
  CheckCircle2, Crown, Play, Repeat, RotateCcw, Scissors, Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type {
  EndodonticDiagnosisRow,
  EndodonticTreatmentFull,
  VitalityTestRow,
} from "@/lib/types/endodontics";

export interface ToothTimelineProps {
  diagnosis: EndodonticDiagnosisRow | null;
  activeTreatment: EndodonticTreatmentFull | null;
  pastTreatments: EndodonticTreatmentFull[];
  recentVitality: VitalityTestRow[];
  onClickEvent: (id: string, kind: string) => void;
}

interface TimelineEvent {
  id: string;
  kind: string;
  date: Date;
  label: string;
  icon: LucideIcon;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  detail?: string;
}

export function ToothTimeline(props: ToothTimelineProps) {
  const events = buildEvents(props);
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <section className="endo-section endo-tooth-timeline" aria-labelledby="endo-timeline-title">
      <header className="endo-tooth-timeline__header">
        <p className="endo-section__eyebrow">Línea de tiempo</p>
        <h2 id="endo-timeline-title" className="endo-section__title">
          Eventos del diente
        </h2>
      </header>

      {events.length === 0 ? (
        <p className="endo-section__placeholder">Sin eventos registrados todavía.</p>
      ) : (
        <ol className="endo-tooth-timeline__list" aria-label="Eventos cronológicos">
          {events.map((ev) => (
            <li
              key={ev.id}
              className={`endo-tooth-timeline__item endo-tooth-timeline__item--${ev.tone}`}
            >
              <button
                type="button"
                onClick={() => props.onClickEvent(ev.id, ev.kind)}
                className="endo-tooth-timeline__btn"
                aria-label={`${ev.label} — ${formatDate(ev.date)}`}
              >
                <span className="endo-tooth-timeline__icon" aria-hidden>
                  <ev.icon size={14} />
                </span>
                <span className="endo-tooth-timeline__body">
                  <span className="endo-tooth-timeline__date">{formatDate(ev.date)}</span>
                  <span className="endo-tooth-timeline__label">{ev.label}</span>
                  {ev.detail ? <span className="endo-tooth-timeline__detail">{ev.detail}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function buildEvents(props: ToothTimelineProps): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (props.diagnosis) {
    events.push({
      id: props.diagnosis.id,
      kind: "diagnosis",
      date: props.diagnosis.diagnosedAt,
      label: "Diagnóstico AAE registrado",
      icon: Stethoscope,
      tone: "info",
      detail: props.diagnosis.justification?.slice(0, 80) ?? undefined,
    });
  }

  for (const v of props.recentVitality) {
    events.push({
      id: v.id,
      kind: "vitality",
      date: v.evaluatedAt,
      label: `Prueba ${labelTest(v.testType)}: ${labelResult(v.result)}`,
      icon: Activity,
      tone: v.result === "EXAGERADO" || v.result === "POSITIVO" ? "warning" : "neutral",
    });
  }

  const allTxs = [
    ...(props.activeTreatment ? [props.activeTreatment] : []),
    ...props.pastTreatments,
  ];
  for (const tx of allTxs) {
    const isRetreatment = tx.treatmentType === "RETRATAMIENTO";
    const isApical = tx.treatmentType === "APICECTOMIA";
    events.push({
      id: tx.id,
      kind: isApical ? "treatment-apical" : isRetreatment ? "treatment-retreatment" : "treatment-start",
      date: tx.startedAt,
      label: isApical
        ? "Cirugía apical iniciada"
        : isRetreatment
          ? "Retratamiento iniciado"
          : "Tratamiento de conductos iniciado",
      icon: isApical ? Scissors : isRetreatment ? RotateCcw : Play,
      tone: isApical ? "warning" : "info",
    });
    for (const med of tx.intracanalMedications ?? []) {
      events.push({
        id: med.id,
        kind: "medication",
        date: med.placedAt,
        label: `Medicación intracanal: ${labelSubstance(med.substance)}`,
        icon: Beaker,
        tone: "info",
      });
      if (med.actualRemovalAt) {
        events.push({
          id: `${med.id}-removed`,
          kind: "medication-removed",
          date: med.actualRemovalAt,
          label: `Medicación retirada: ${labelSubstance(med.substance)}`,
          icon: Repeat,
          tone: "neutral",
        });
      }
    }
    if (tx.completedAt) {
      events.push({
        id: `${tx.id}-completed`,
        kind: "treatment-completed",
        date: tx.completedAt,
        label: "Obturación final",
        icon: CheckCircle2,
        tone: "success",
      });
    }
    if (tx.postOpRestorationCompletedAt) {
      events.push({
        id: `${tx.id}-restoration`,
        kind: "restoration",
        date: tx.postOpRestorationCompletedAt,
        label: "Restauración pos-TC",
        icon: Crown,
        tone: "success",
      });
    }
    for (const fu of tx.followUps ?? []) {
      const performed = fu.performedAt;
      events.push({
        id: fu.id,
        kind: "followup",
        date: performed ?? fu.scheduledAt,
        label: performed
          ? `Control ${labelMilestone(fu.milestone)} realizado`
          : `Control ${labelMilestone(fu.milestone)} programado`,
        icon: performed ? CalendarCheck : CalendarClock,
        tone: !performed
          ? "neutral"
          : fu.conclusion === "EXITO"
            ? "success"
            : fu.conclusion === "FRACASO"
              ? "danger"
              : "warning",
        detail: fu.paiScore ? `PAI ${fu.paiScore}/5` : undefined,
      });
    }
  }

  return events;
}

function labelTest(t: string): string {
  const map: Record<string, string> = {
    FRIO: "Frío", CALOR: "Calor", EPT: "EPT",
    PERCUSION_VERTICAL: "Percusión vertical", PERCUSION_HORIZONTAL: "Percusión horizontal",
    PALPACION_APICAL: "Palpación apical", MORDIDA_TOOTHSLOOTH: "Mordida",
  };
  return map[t] ?? t;
}

function labelResult(r: string): string {
  const map: Record<string, string> = {
    POSITIVO: "positivo", NEGATIVO: "negativo",
    EXAGERADO: "exagerado", DIFERIDO: "diferido", SIN_RESPUESTA: "sin respuesta",
  };
  return map[r] ?? r;
}

function labelSubstance(s: string): string {
  const map: Record<string, string> = {
    HIDROXIDO_CALCIO: "Hidróxido de calcio",
    CTZ: "CTZ", LEDERMIX: "Ledermix",
    FORMOCRESOL: "Formocresol", PROPILENGLICOL: "Propilenglicol",
    OTRO: "Otro",
  };
  return map[s] ?? s;
}

function labelMilestone(m: string): string {
  const map: Record<string, string> = {
    CONTROL_6M: "6 meses", CONTROL_12M: "12 meses",
    CONTROL_24M: "24 meses", CONTROL_EXTRA: "extra",
  };
  return map[m] ?? m;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

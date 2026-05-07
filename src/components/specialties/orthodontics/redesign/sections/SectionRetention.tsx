"use client";
// Sección G — Retención · G9 régimen retención automatizado.
//
// 3 sub-bloques:
//   - Tipo de retenedor: 3 cards (Superior / Inferior / Fijo lingual 3-3)
//   - Régimen de uso: barra dividida horizontal "24/7 año 1" + "Nocturno años 2-5"
//   - Auto-scheduling: 5 cards (3m / 6m / 12m / 24m / 36m) + toggle pre-encuesta WA
//
// Trigger automático al avanzar fase a Retención: crear LabOrder retainer +
// agendar 5 revisiones (lo dispara advancePhase server action).

import { MessageCircle } from "lucide-react";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { fmtDateShort } from "../atoms/format";

export type RetainerArchwireGauge = "G_0175" | "G_0195" | "G_021";

const GAUGE_LABEL: Record<RetainerArchwireGauge, string> = {
  G_0175: ".0175",
  G_0195: ".0195",
  G_021: ".021",
};

export interface RetainerCheckupDTO {
  id: string;
  monthsFromDebond: 3 | 6 | 12 | 24 | 36 | number;
  scheduledDate: string;
  status: "PROGRAMMED" | "COMPLETED" | "MISSED" | "CANCELLED";
}

export interface RetentionRegimenDTO {
  id: string | null;
  upperLabel: string | null;
  upperDescription: string | null;
  lowerLabel: string | null;
  lowerDescription: string | null;
  fixedLingualPresent: boolean;
  fixedLingualGauge: RetainerArchwireGauge | null;
  regimenDescription: string;
  preSurveyEnabled: boolean;
  debondedAt: string | null;
}

export interface SectionRetentionProps {
  /** Régimen pre-cargado o null si aún no debondado. */
  regimen: RetentionRegimenDTO | null;
  /** Lista de checkups (3/6/12/24/36 meses). */
  checkups: RetainerCheckupDTO[];
  /** Estado actual del tratamiento — usado para derivar "Activa" vs "Programada". */
  treatmentStatus: "no-iniciado" | "en-tratamiento" | "retencion" | "completado";
  onTogglePreSurvey?: (enabled: boolean) => Promise<void> | void;
  onConfigureRegimen?: () => void;
}

const STATUS_LABEL: Record<RetainerCheckupDTO["status"], string> = {
  PROGRAMMED: "futura",
  COMPLETED: "realizada",
  MISSED: "perdida",
  CANCELLED: "cancelada",
};

const STATUS_COLOR: Record<RetainerCheckupDTO["status"], "slate" | "emerald" | "rose"> = {
  PROGRAMMED: "slate",
  COMPLETED: "emerald",
  MISSED: "rose",
  CANCELLED: "slate",
};

export function SectionRetention(props: SectionRetentionProps) {
  const isActive = props.treatmentStatus === "retencion";
  const r = props.regimen ?? defaultPlanned();

  const upperLabel = r.upperLabel ?? "Hawley sup";
  const lowerLabel = r.lowerLabel ?? "Essix inf";
  const fixedLabel = r.fixedLingualGauge ? GAUGE_LABEL[r.fixedLingualGauge] : ".0195";

  return (
    <Card
      id="retention"
      eyebrow="Sección G · G9 régimen retención automatizado"
      title="Retención"
      action={
        <Pill color={isActive ? "emerald" : "slate"} size="xs">
          {isActive ? "Activa" : "Programada — inicia tras debonding"}
        </Pill>
      }
    >
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
          Tipo de retenedor
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RetainerCard
            label="Superior"
            value={upperLabel}
            sub={r.upperDescription ?? "Acrílico + arco vestibular"}
          />
          <RetainerCard
            label="Inferior"
            value={lowerLabel}
            sub={r.lowerDescription ?? "Termoformado transparente"}
          />
          <RetainerCard
            label="Fijo lingual 3-3"
            value={fixedLabel}
            sub="Acero trenzado, mandibular"
            mono
          />
        </div>
      </div>

      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
          Régimen de uso
        </div>
        <div
          className="relative h-10 bg-slate-50 border border-slate-200 rounded-md overflow-hidden dark:bg-slate-800 dark:border-slate-700"
          role="img"
          aria-label="Régimen 24/7 año 1 luego nocturno años 2-5"
        >
          <div
            className="absolute inset-y-0 left-0 bg-violet-200 flex items-center justify-center text-[11px] font-semibold text-violet-900 dark:bg-violet-900/40 dark:text-violet-200"
            style={{ width: "20%" }}
          >
            24/7 · año 1
          </div>
          <div
            className="absolute inset-y-0 bg-violet-100/60 flex items-center justify-center text-[11px] font-medium text-violet-800 dark:bg-violet-900/20 dark:text-violet-300"
            style={{ left: "20%", width: "80%" }}
          >
            Nocturno · años 2-5
          </div>
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-400 font-mono dark:text-slate-500">
          <span>Debond</span>
          <span>+12m</span>
          <span>+24m</span>
          <span>+36m</span>
          <span>+60m</span>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
            Auto-scheduling de controles
          </h4>
          <PreSurveyToggle
            enabled={r.preSurveyEnabled}
            onChange={(v) => void props.onTogglePreSurvey?.(v)}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(props.checkups.length > 0 ? props.checkups : defaultCheckups()).map((c) => (
            <CheckupCard key={c.id} checkup={c} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function RetainerCard({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-violet-200 bg-violet-50 rounded-lg p-3 dark:bg-violet-900/20 dark:border-violet-800">
      <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
        {label}
      </div>
      <div
        className={`mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{sub}</div>
    </div>
  );
}

function PreSurveyToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <MessageCircle
        className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
      <span className="text-[11px] text-slate-700 dark:text-slate-300">
        Pre-formulario {`"`}¿estás usándolo?{`"`} {enabled ? "activo" : "desactivado"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`w-7 h-4 rounded-full relative transition-colors ${
          enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${
            enabled ? "right-0.5" : "left-0.5"
          }`}
          aria-hidden
        />
      </button>
    </div>
  );
}

function CheckupCard({ checkup }: { checkup: RetainerCheckupDTO }) {
  return (
    <div className="border border-slate-200 rounded-md p-3 text-center bg-white dark:bg-slate-900 dark:border-slate-700">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Control
      </div>
      <div className="text-base font-bold text-slate-900 mt-0.5 dark:text-slate-100">
        {checkup.monthsFromDebond}m
      </div>
      <div className="text-[10px] text-slate-500 mt-1 dark:text-slate-400">
        {fmtDateShort(checkup.scheduledDate)}
      </div>
      <Pill color={STATUS_COLOR[checkup.status]} size="xs">
        {STATUS_LABEL[checkup.status]}
      </Pill>
    </div>
  );
}

function defaultPlanned(): RetentionRegimenDTO {
  return {
    id: null,
    upperLabel: "Hawley sup",
    upperDescription: "Acrílico + arco vestibular",
    lowerLabel: "Essix inf",
    lowerDescription: "Termoformado transparente",
    fixedLingualPresent: true,
    fixedLingualGauge: "G_0195",
    regimenDescription: "24/7 año 1 · nocturno años 2-5",
    preSurveyEnabled: true,
    debondedAt: null,
  };
}

function defaultCheckups(): RetainerCheckupDTO[] {
  // Visualización pre-debond: muestra los slots como futuros sin fecha.
  return [3, 6, 12, 24, 36].map((m) => ({
    id: `placeholder-${m}`,
    monthsFromDebond: m,
    scheduledDate: "",
    status: "PROGRAMMED",
  }));
}

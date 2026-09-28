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

import { MessageCircle, Shield } from "lucide-react";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { fmtDateShort } from "../atoms/format";
import orto from "../orto.module.css";

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
      icon={<Shield size={15} strokeWidth={1.75} />}
      title="Retención"
      eyebrow="Retenedores, régimen de uso y controles"
      action={
        <Pill color={isActive ? "emerald" : "slate"}>
          {isActive ? "Activa" : "Empieza al retirar los brackets"}
        </Pill>
      }
    >
      <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
        <h4 className={`${orto.bloqueTitulo} mb-[10px]`}>Tipo de retenedor</h4>
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

      <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
        <h4 className={`${orto.bloqueTitulo} mb-[10px]`}>Régimen de uso</h4>
        {/* Dos tramos en fila: el primero nunca mide menos que su rótulo (en el
            teléfono, al 20 % del ancho, «24 h · año 1» se salía de su caja). */}
        <div
          className="flex h-9 border border-[color:var(--orto-violeta-borde)] rounded-[10px] overflow-hidden"
          role="img"
          aria-label="Régimen: 24 horas el primer año y después nocturno del año 2 al 5"
        >
          <div
            className="flex-none min-w-[88px] bg-[color:var(--pr-activo)] flex items-center justify-center px-2 text-[11px] font-semibold text-[color:var(--pr-activo-texto)] whitespace-nowrap"
            style={{ width: "20%" }}
          >
            24 h · año 1
          </div>
          <div className="flex-1 min-w-0 bg-[color:var(--pr-activo-suave)] flex items-center justify-center px-2 text-[11px] font-semibold text-[color:var(--orto-violeta)] whitespace-nowrap">
            Nocturno · años 2-5
          </div>
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-[color:var(--pr-texto-3)] tabular-nums">
          <span>Retiro</span>
          <span>1 año</span>
          <span>2 años</span>
          <span>3 años</span>
          <span>5 años</span>
        </div>
      </div>

      <div className="px-[18px] py-[16px]">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h4 className={orto.bloqueTitulo}>Controles de retención</h4>
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
    <div className={orto.caja}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className={`${orto.datoValor} ${mono ? "tabular-nums" : ""}`}>{value}</div>
      <div className={orto.datoSub}>{sub}</div>
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
      <MessageCircle size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />
      <span className="text-xs text-[color:var(--pr-texto-2)]" id="orto-pre-encuesta">
        Preguntar antes «¿estás usando tu retenedor?»
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="orto-pre-encuesta"
        onClick={() => onChange(!enabled)}
        className={`w-9 h-5 rounded-full relative transition-colors flex-none ${
          enabled ? "bg-[color:var(--pr-activo)]" : "bg-[color:var(--pr-texto-3)]"
        }`}
      >
        <span
          className={`absolute top-[2px] w-4 h-4 bg-[color:var(--pr-tarjeta)] rounded-full transition-all ${
            enabled ? "left-[18px]" : "left-[2px]"
          }`}
          aria-hidden
        />
      </button>
    </div>
  );
}

function CheckupCard({ checkup }: { checkup: RetainerCheckupDTO }) {
  return (
    <div className={`${orto.caja} text-center flex flex-col items-center gap-[3px]`}>
      <div className="text-[15px] font-bold leading-tight">
        {checkup.monthsFromDebond} {checkup.monthsFromDebond === 1 ? "mes" : "meses"}
      </div>
      <div className="text-[11.5px] text-[color:var(--pr-texto-3)]">
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

"use client";
// Sección A — Resumen del tratamiento.
//
// Cubre los dos estados:
//   1. Sin tratamiento activo (status no-iniciado): estado vacío con el botón
//      que abre el caso.
//   2. En tratamiento: mes X de Y + fase, cuatro datos, barra de avance y las
//      fases con la actual marcada.
//
// ws1-t4 ronda 6 (revisión de lógica de uso, filas 8 y 27, y sección H):
//  - «Asistencia» y «Uso de elásticos» dicen lo que pasó de verdad, con de
//    dónde sale el número; sin datos pintan «—», no un 100 % ni un 0 %.
//  - «Aparatología» dice primero QUÉ lleva el paciente («Brackets
//    metálicos»); antes decía «Sin definir» encima del tipo.
//  - El expediente de ortodoncia es el «caso», con su estado en palabras.
//  - El botón que abre la aparatología se llama así, no «Editar plan».

import { Activity, ChevronRight, ClipboardCheck, Layers, Pencil, Plus, Settings } from "lucide-react";
import { Btn, Card, StatChip, fmtDayLong, fmtPct } from "../atoms";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import {
  APPLIANCE_SLOT_LABELS,
  PHASE_LABELS,
  PHASE_ORDER,
  type OrthoTreatmentDTO,
} from "../types";
import { bracketsDelCaso, cooperacionDelPaciente, type ControlParaResumen } from "@/lib/orthodontics/resumen-del-caso";
import orto from "../orto.module.css";

export interface SectionHeroProps {
  treatment: OrthoTreatmentDTO;
  /** H66: controles del caso, para los brackets caídos acumulados. */
  cards?: readonly ControlParaResumen[];
  hasUpcomingControlToday?: boolean;
  onStartTreatment?: () => void;
  onEditPlan?: () => void;
  /** Ola 1 (ws1-t6) — A5/A6/A7/A11: doctor tratante, responsable del pago,
   *  fecha de colocación y estado del caso. */
  onOpenCaseSettings?: () => void;
  onStartControl?: () => void;
  onAdvancePhase?: () => void;
}

export function SectionHero(props: SectionHeroProps) {
  const t = props.treatment;

  if (t.status === "no-iniciado") {
    return <HeroEmptyState onStart={props.onStartTreatment} />;
  }

  const progressPct =
    t.monthTotal > 0 ? Math.min(100, Math.round((t.monthCurrent / t.monthTotal) * 100)) : 0;
  // Primero qué lleva; debajo, la prescripción. Antes salía «Sin definir»
  // como dato principal aunque el tipo sí estuviera capturado.
  const applianceLabel = t.appliance.type ?? "Sin definir";
  const applianceSub = t.appliance.prescriptionSlot
    ? `Prescripción ${APPLIANCE_SLOT_LABELS[t.appliance.prescriptionSlot]}`
    : t.appliance.type
      ? "Prescripción sin definir"
      : "—";
  // Con los indicadores de verdad, `pct: null` es «sin datos». Sin ellos
  // (quien arma el objeto a mano), los dos números de siempre.
  const asistencia = t.attendance ? t.attendance.pct : t.attendancePct;
  const elasticos = t.elastics ? t.elastics.pct : t.elasticsCompliancePct;
  const asistenciaSub = !t.attendance
    ? "últimos 6 meses"
    : t.attendance.pct === null
      ? "sin controles registrados"
      : t.attendance.falto === 0
        ? `${t.attendance.asistio} de ${t.attendance.asistio} controles · 6 meses`
        : `faltó a ${t.attendance.falto} de ${t.attendance.asistio + t.attendance.falto} · 6 meses`;
  const elasticosSub = !t.elastics
    ? t.wireCurrent
      ? "uso 22 h/día"
      : "no aplica"
    : t.elastics.pct === null
      ? "sin registros del paciente"
      : `${t.elastics.diasRegistrados} de ${t.elastics.ventanaDias} días registrados`;
  const wireLabel = t.wireCurrent
    ? `${formatWireLabel(t.wireCurrent)}`
    : "Sin arco activo";
  const elasticTone =
    (elasticos ?? 0) >= 85 ? "emerald" : (elasticos ?? 0) >= 70 ? "amber" : "rose";
  const phaseIndex = t.phase ? PHASE_ORDER.indexOf(t.phase) : -1;

  return (
    <Card
      id="hero"
      icon={<Activity size={15} strokeWidth={1.75} />}
      title={
        <>
          Mes {t.monthCurrent} de {t.monthTotal}
          {t.phase ? (
            <span className={orto.tonoApagado} style={{ fontWeight: 500 }}>
              {" "}
              · {PHASE_LABELS[t.phase]}
            </span>
          ) : null}
        </>
      }
      eyebrow={t.caseStatusLabel ? `Caso de ortodoncia · ${t.caseStatusLabel}` : "Caso de ortodoncia"}
      action={
        <>
          {props.onOpenCaseSettings ? (
            <Btn
              variant="secondary"
              size="sm"
              icon={<Settings size={14} strokeWidth={1.75} aria-hidden />}
              onClick={props.onOpenCaseSettings}
            >
              Datos del caso
            </Btn>
          ) : null}
          {props.onEditPlan ? (
            <Btn
              variant="secondary"
              size="sm"
              icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />}
              onClick={props.onEditPlan}
            >
              Editar aparatología
            </Btn>
          ) : null}
          {props.onStartControl ? (
            <Btn
              variant="primary"
              size="sm"
              icon={<ClipboardCheck size={14} strokeWidth={1.75} aria-hidden />}
              onClick={props.onStartControl}
            >
              {props.hasUpcomingControlToday ? "Registrar control de hoy" : "Registrar control"}
            </Btn>
          ) : null}
        </>
      }
    >
      <div className={orto.tarjetaCuerpo}>
        <div className={orto.rejilla4}>
          <StatChip
            label="Aparatología"
            value={applianceLabel}
            sub={applianceSub}
          />
          <StatChip
            label="Arco actual"
            value={wireLabel}
            sub={t.wireCurrent?.purpose ?? "—"}
          />
          <StatChip
            label="Asistencia"
            value={fmtPct(asistencia)}
            sub={asistenciaSub}
            delta={asistencia !== null && asistencia < 80 ? "baja" : undefined}
            deltaColor={asistencia !== null && asistencia < 60 ? "rose" : "amber"}
          />
          <StatChip
            label="Uso de elásticos"
            value={fmtPct(elasticos)}
            sub={elasticosSub}
            // Sin datos no hay nada que marcar como bajo.
            delta={elasticos !== null && elasticos < 80 && (t.elastics || t.wireCurrent) ? "bajo" : undefined}
            deltaColor={elasticTone === "rose" ? "rose" : elasticTone === "amber" ? "amber" : "emerald"}
          />
        </div>

        {(() => {
          const cooperacion = cooperacionDelPaciente(asistencia, elasticos);
          const brackets = props.cards ? bracketsDelCaso(props.cards) : null;
          if (!cooperacion && !(brackets && brackets.caidos > 0)) return null;
          return (
            <p className={`${orto.tonoApagado} mt-[12px] text-[12.5px]`}>
              {cooperacion ? <>Cooperación del paciente: <strong>{cooperacion}</strong></> : null}
              {cooperacion && brackets && brackets.caidos > 0 ? " · " : null}
              {brackets && brackets.caidos > 0 ? (
                <>
                  Brackets caídos en el caso: <strong>{brackets.caidos}</strong>
                  {brackets.pendientes > 0 ? ` (${brackets.pendientes} sin recementar)` : ""}
                </>
              ) : null}
            </p>
          );
        })()}

        <div className="mt-[18px]">
          <div className="flex items-baseline justify-between gap-3 mb-[7px]">
            <span className={orto.ceja}>Avance del tratamiento</span>
            <span className="text-[13px] font-semibold">{progressPct}%</span>
          </div>
          <ProgressBar
            value={progressPct}
            ariaLabel={`Mes ${t.monthCurrent} de ${t.monthTotal}`}
          />
          <div className={`${orto.tonoApagado} flex justify-between gap-3 mt-[6px] text-[11.5px]`}>
            <span>Inicio · {fmtDayLong(t.startDate)}</span>
            <span className="text-right">Fin estimado · {fmtDayLong(t.estimatedEndDate)}</span>
          </div>
        </div>

        <div className="mt-[14px] flex gap-[6px] flex-wrap items-center">
          {PHASE_ORDER.map((ph, i) => (
            <Pill
              key={ph}
              color={ph === t.phase ? "violet" : phaseIndex >= 0 && i < phaseIndex ? "emerald" : "slate"}
            >
              {PHASE_LABELS[ph]}
            </Pill>
          ))}
          {props.onAdvancePhase && t.phase ? (
            <Btn
              variant="violet-soft"
              size="sm"
              className="ml-auto"
              icon={<ChevronRight size={14} strokeWidth={1.75} aria-hidden />}
              onClick={props.onAdvancePhase}
            >
              Avanzar de fase
            </Btn>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function HeroEmptyState({ onStart }: { onStart?: () => void }) {
  return (
    <Card id="hero">
      <div className={orto.tarjetaCuerpo}>
        <div className={`${orto.vacio} ${orto.vacioAmplio}`}>
          <span className={orto.vacioIcono} aria-hidden>
            <Layers size={18} strokeWidth={1.75} />
          </span>
          <h3 className={orto.vacioTitulo}>Este paciente no tiene un caso de ortodoncia abierto</h3>
          <p className={orto.vacioPista}>
            Abre el caso con su diagnóstico y su plan. A partir de ahí se registran los
            controles, las fotos y el cobro.
          </p>
          {onStart ? (
            <Btn
              variant="primary"
              size="md"
              className="mt-1"
              icon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
              onClick={onStart}
            >
              Abrir caso de ortodoncia
            </Btn>
          ) : null}
        </div>
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

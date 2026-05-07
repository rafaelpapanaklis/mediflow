"use client";
// PatientHeader con G16 (patient flow) — componente del shell del patient-detail
// del rediseño Ortodoncia. Renderiza:
//   - Avatar circular violet con iniciales
//   - Nombre + datos demográficos + tutor + alergia badge rose
//   - G16 badge emerald (si paciente está en clínica) con sillón asignado
//   - 4 stats horizontales: PRÓXIMA CITA / SALDO / ÚLTIMA VISITA / VISITAS TOTALES
//   - Botones acción derecha: Iniciar consulta · Agendar próxima · Cobrar · ⋯

import { Calendar, DollarSign, MoreHorizontal, Phone, Play } from "lucide-react";
import { Btn } from "./atoms/Btn";
import { Pill } from "./atoms/Pill";
import { fmtDate, fmtDateShort, fmtMoney, fmtTime } from "./atoms/format";
import { FLOW_STATUS_LABELS, type NextAppointmentDTO, type PatientFlowDTO } from "./types";

export interface PatientHeaderProps {
  /** Datos del paciente. */
  patient: {
    id: string;
    fullName: string;
    avatarInitials: string;
    age: number | null;
    sex: "F" | "M" | "X" | null;
    phone: string | null;
    email: string | null;
    bloodType: string | null;
    /** Tutor — nombre + relación (ej. "María Ruiz (madre)"). */
    guardianLabel: string | null;
    /** Alergias críticas (texto corto, ej. "Penicilina"). */
    criticalAllergies: string | null;
  };
  /** PatientFlow G16 — null si no está en clínica. */
  patientFlow: PatientFlowDTO | null;
  /** Próxima cita. */
  nextAppointment: NextAppointmentDTO | null;
  /** Saldo pendiente del tratamiento ortodóntico. */
  outstandingAmount: number;
  /** Fecha de la última visita registrada. */
  lastVisitAt: string | null;
  /** Conteo total de visitas (asistidas) y "desde N". */
  totalVisits: { count: number; sinceLabel: string | null };
  /** Acciones del header. */
  onStartVisit?: () => void;
  onScheduleNext?: () => void;
  onCollect?: () => void;
  onMore?: () => void;
}

export function PatientHeaderG16(props: PatientHeaderProps) {
  const p = props.patient;
  const flow = props.patientFlow;
  const next = props.nextAppointment;

  const sexLabel = p.sex === "F" ? "F" : p.sex === "M" ? "M" : p.sex === "X" ? "—" : null;
  const ageLabel = p.age != null ? `${p.age} años` : "edad —";

  return (
    <header className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
      <div className="flex items-start gap-4 flex-wrap">
        {/* Avatar */}
        <div
          className="w-16 h-16 rounded-full bg-violet-600 text-white flex items-center justify-center text-xl font-semibold flex-shrink-0 dark:bg-violet-500"
          aria-hidden
        >
          {p.avatarInitials}
        </div>

        {/* Title block */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {p.fullName}
            </h1>
            <span className="text-xs text-slate-400 font-mono dark:text-slate-500">
              # {p.id.slice(0, 8)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap dark:text-slate-400">
            <span>{ageLabel}</span>
            {sexLabel ? <Sep>{sexLabel}</Sep> : null}
            {p.phone ? (
              <Sep>
                <Phone className="w-3 h-3 inline -mt-0.5" aria-hidden /> {p.phone}
              </Sep>
            ) : null}
            {p.email ? <Sep>{p.email}</Sep> : null}
            {p.bloodType ? <Sep>{p.bloodType}</Sep> : null}
            {p.guardianLabel ? <Sep>Tutor: {p.guardianLabel}</Sep> : null}
          </div>
          {/* Allergy + Flow badges */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {p.criticalAllergies ? (
              <Pill color="rose" size="xs">
                ⚠ Alergia: {p.criticalAllergies}
              </Pill>
            ) : null}
            {flow ? (
              <Pill color="emerald" size="xs">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"
                  aria-hidden
                />{" "}
                En clínica · {FLOW_STATUS_LABELS[flow.status].toLowerCase()} desde{" "}
                {fmtTime(flow.enteredAt)}
                {flow.chair ? ` · ${flow.chair}` : ""} · G16
              </Pill>
            ) : null}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap items-start">
          {props.onStartVisit ? (
            <Btn
              variant="violet-soft"
              size="md"
              icon={<Play className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onStartVisit}
            >
              Iniciar consulta
            </Btn>
          ) : null}
          {props.onScheduleNext ? (
            <Btn
              variant="ghost"
              size="md"
              icon={<Calendar className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onScheduleNext}
            >
              Agendar próxima
            </Btn>
          ) : null}
          {props.onCollect ? (
            <Btn
              variant="emerald"
              size="md"
              icon={<DollarSign className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onCollect}
            >
              Cobrar
            </Btn>
          ) : null}
          {props.onMore ? (
            <Btn
              variant="ghost"
              size="md"
              onClick={props.onMore}
              aria-label="Más opciones"
            >
              <MoreHorizontal className="w-4 h-4" aria-hidden />
            </Btn>
          ) : null}
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 dark:border-slate-800">
        <Stat
          label="Próxima cita"
          value={next ? fmtDate(next.date) : "Sin programar"}
          sub={
            next ? `${fmtTime(next.date)} · ${next.type}` : "Agenda una nueva cita"
          }
        />
        <Stat
          label="Saldo ortodoncia"
          value={fmtMoney(props.outstandingAmount)}
          sub={props.outstandingAmount > 0 ? "Pendiente" : "Al día"}
          tone={props.outstandingAmount > 0 ? "rose" : "emerald"}
        />
        <Stat
          label="Última visita"
          value={fmtDateShort(props.lastVisitAt) || "—"}
          sub={props.lastVisitAt ? `hace ${daysAgo(props.lastVisitAt)} días` : ""}
        />
        <Stat
          label="Visitas totales"
          value={String(props.totalVisits.count)}
          sub={props.totalVisits.sinceLabel ?? ""}
        />
      </div>
    </header>
  );
}

function Sep({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="text-slate-300 dark:text-slate-600" aria-hidden>
        ·
      </span>
      <span>{children}</span>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "emerald" | "rose";
}) {
  const valueCls =
    tone === "rose"
      ? "text-rose-700 dark:text-rose-400"
      : tone === "emerald"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-slate-900 dark:text-slate-100";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium dark:text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-base font-bold ${valueCls}`}>{value}</div>
      {sub ? (
        <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{sub}</div>
      ) : null}
    </div>
  );
}

function daysAgo(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const diffMs = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

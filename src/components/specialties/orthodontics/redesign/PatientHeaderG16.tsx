"use client";
// Cabecera del paciente dentro de la pestaña de Ortodoncia. Habla el mismo
// idioma que la cabecera de la ficha (`.heroRediseno`): avatar cuadrado de
// esquinas redondas, nombre a 22 px, una línea de datos y los botones a la
// derecha. Debajo, cuatro datos del caso separados por una línea — sin cajas
// dentro de la caja.
//
// El botón que MANDA es «Registrar control»: es lo que se hace veinte veces
// al día en esta pantalla. Los demás conservan su sitio y su función.

import { Calendar, ClipboardCheck, DollarSign, MoreHorizontal, Phone, Play } from "lucide-react";
import { Btn } from "./atoms/Btn";
import { Pill } from "./atoms/Pill";
import { fmtDate, fmtDateShort, fmtMoney, fmtTime } from "./atoms/format";
import { FLOW_STATUS_LABELS, type NextAppointmentDTO, type PatientFlowDTO } from "./types";
import orto from "./orto.module.css";

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
  /**
   * Saldo pendiente del tratamiento ortodóntico, de la factura real del
   * caso — `null` mientras carga o si el caso todavía no tiene factura
   * (hallazgo ws1-t4 §5: antes esto era el precio de REFERENCIA del plan,
   * y decía "Pendiente" aunque nadie hubiera abierto ninguna factura).
   */
  outstandingAmount: number | null;
  /** Fecha de la última visita registrada. */
  lastVisitAt: string | null;
  /** Conteo total de visitas (asistidas) y "desde N". */
  totalVisits: { count: number; sinceLabel: string | null };
  /** Acciones del header. */
  onStartVisit?: () => void;
  onScheduleNext?: () => void;
  onCollect?: () => void;
  onMore?: () => void;
  /** Abre la hoja de control de hoy. Solo llega con un caso abierto. */
  onStartControl?: () => void;
  /** Hay un control agendado para hoy: cambia el rótulo del botón. */
  controlIsToday?: boolean;
}

export function PatientHeaderG16(props: PatientHeaderProps) {
  const p = props.patient;
  const flow = props.patientFlow;
  const next = props.nextAppointment;

  const sexLabel = p.sex === "F" ? "F" : p.sex === "M" ? "M" : p.sex === "X" ? "—" : null;
  const ageLabel = p.age != null ? `${p.age} años` : "edad —";
  const meta: React.ReactNode[] = [ageLabel];
  if (sexLabel) meta.push(sexLabel);
  if (p.phone) {
    meta.push(
      <>
        <Phone size={12} strokeWidth={1.75} aria-hidden /> {p.phone}
      </>,
    );
  }
  if (p.email) meta.push(p.email);
  if (p.bloodType) meta.push(p.bloodType);
  if (p.guardianLabel) meta.push(`Tutor: ${p.guardianLabel}`);

  return (
    <header className={orto.cabecera}>
      <div className={orto.cabeceraPrincipal}>
        <div className={orto.avatar} aria-hidden>
          {p.avatarInitials}
        </div>

        <div className={orto.cabeceraInfo}>
          <h1 className={orto.cabeceraNombre}>{p.fullName}</h1>
          <div className={orto.cabeceraMeta}>
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 ? (
                  <span className={orto.metaSep} aria-hidden>
                    ·
                  </span>
                ) : null}
                {m}
              </span>
            ))}
          </div>
          {p.criticalAllergies || flow ? (
            <div className={orto.cabeceraAvisos}>
              {p.criticalAllergies ? (
                <Pill color="rose">Alergia: {p.criticalAllergies}</Pill>
              ) : null}
              {flow ? (
                <Pill color="amber">
                  <span className={`${orto.punto} ${orto.puntoVivo}`} aria-hidden />
                  En clínica · {FLOW_STATUS_LABELS[flow.status].toLowerCase()} desde{" "}
                  {fmtTime(flow.enteredAt)}
                  {flow.chair ? ` · ${flow.chair}` : ""}
                </Pill>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={orto.cabeceraAcciones}>
          {props.onStartControl ? (
            <Btn
              variant="primary"
              size="lg"
              icon={<ClipboardCheck size={16} strokeWidth={1.75} aria-hidden />}
              onClick={props.onStartControl}
            >
              {props.controlIsToday ? "Registrar control de hoy" : "Registrar control"}
            </Btn>
          ) : null}
          {props.onStartVisit ? (
            <Btn
              variant={props.onStartControl ? "secondary" : "primary"}
              size="md"
              icon={<Play size={15} strokeWidth={1.75} aria-hidden />}
              onClick={props.onStartVisit}
            >
              Iniciar consulta
            </Btn>
          ) : null}
          {props.onScheduleNext ? (
            <Btn
              variant="secondary"
              size="md"
              icon={<Calendar size={15} strokeWidth={1.75} aria-hidden />}
              onClick={props.onScheduleNext}
            >
              Agendar próxima
            </Btn>
          ) : null}
          {props.onCollect ? (
            <Btn
              variant="secondary"
              size="md"
              icon={<DollarSign size={15} strokeWidth={1.75} aria-hidden />}
              onClick={props.onCollect}
            >
              Cobrar
            </Btn>
          ) : null}
          {props.onMore ? (
            <Btn variant="secondary" size="md" onClick={props.onMore} aria-label="Más opciones">
              <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
            </Btn>
          ) : null}
        </div>
      </div>

      <div className={orto.datos}>
        <Stat
          label="Próxima cita"
          value={next ? fmtDate(next.date) : "Sin programar"}
          sub={next ? `${fmtTime(next.date)} · ${next.type}` : "Agenda una nueva cita"}
          muted={!next}
        />
        <Stat
          label="Saldo de ortodoncia"
          value={props.outstandingAmount != null ? fmtMoney(props.outstandingAmount) : "—"}
          sub={
            props.outstandingAmount == null
              ? "Sin plan de pago"
              : props.outstandingAmount > 0
                ? "Pendiente"
                : "Al día"
          }
          muted={props.outstandingAmount == null}
          tone={props.outstandingAmount != null && props.outstandingAmount > 0 ? "rose" : "emerald"}
        />
        <Stat
          label="Última visita"
          value={fmtDateShort(props.lastVisitAt) || "—"}
          sub={props.lastVisitAt ? haceCuanto(daysAgo(props.lastVisitAt)) : ""}
        />
        <Stat
          label="Visitas"
          value={String(props.totalVisits.count)}
          sub={props.totalVisits.sinceLabel ?? ""}
        />
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  muted,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "emerald" | "rose";
  muted?: boolean;
}) {
  const valueCls =
    tone === "rose"
      ? orto.tonoPeligro
      : tone === "emerald"
        ? orto.tonoExito
        : muted
          ? orto.tonoTexto2
          : "";
  return (
    <div className={orto.dato}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className={[orto.datoValor, valueCls].filter(Boolean).join(" ")}>{value}</div>
      {sub ? <div className={orto.datoSub}>{sub}</div> : null}
    </div>
  );
}

/** «hoy», «ayer», «hace N días» — no «hace 0 días» (ws1-t4 ronda 6). */
function haceCuanto(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

function daysAgo(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const diffMs = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

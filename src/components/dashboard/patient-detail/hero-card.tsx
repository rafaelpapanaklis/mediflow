"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import {
  Play,
  CalendarClock,
  CreditCard,
  MoreHorizontal,
  Edit,
  ExternalLink,
  Printer,
  Calendar,
  Phone,
  Mail,
  Archive,
  Download,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ageFromDob } from "@/lib/format";
import styles from "./patient-detail.module.css";

export interface HeroCardProps {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    patientNumber: string;
    gender: string;
    dob: string | null;
    phone: string | null;
    email: string | null;
    bloodType: string | null;
    status: string;
  };
  nextAppointment: {
    id: string;
    date: string;
    startTime: string;
    type?: string;
    doctorName?: string;
  } | null;
  lastVisitDate: string | null;
  visitCount: number;
  pendingBalance: number;
  portalUrl: string | null;
  onEdit: () => void;
  onStartConsult: () => void;
  onReschedule: () => void;
  onCharge: () => void;
  // Acciones extra del menú "...". Opcionales por compat con otros usos del HeroCard.
  onArchive?: () => void;
  onExportCda?: () => void;
}

function fmtShortDate(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" })
    .format(new Date(iso))
    .replace(/\./g, "");
}

function patientInitials(first: string, last: string): string {
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "?";
}

export function HeroCard({
  patient,
  nextAppointment,
  lastVisitDate,
  visitCount,
  pendingBalance,
  portalUrl,
  onEdit,
  onStartConsult,
  onReschedule,
  onCharge,
  onArchive,
  onExportCda,
}: HeroCardProps) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const age = ageFromDob(patient.dob);
  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const initials = patientInitials(patient.firstName, patient.lastName);
  const genderShort = patient.gender === "F" ? "F" : patient.gender === "M" ? "M" : "O";

  const hasBalance = pendingBalance > 0;
  const hasNextAppt = nextAppointment !== null;

  return (
    <section className={styles.hero} aria-label="Resumen del paciente">
      <div className={styles.heroMain}>
        <div className={styles.heroAvatar} aria-hidden>
          {initials}
        </div>

        <div className={styles.heroInfo}>
          <h1 className={styles.heroName}>{fullName}</h1>
          <div className={styles.heroMeta}>
            <span className={styles.mono}>#{patient.patientNumber}</span>
            <span className={styles.heroMetaSep}>·</span>
            {age !== null && (
              <>
                <span className={styles.mono}>{age}a</span>
                <span className={styles.heroMetaSep}>·</span>
              </>
            )}
            <span className={styles.mono}>{genderShort}</span>
            {patient.phone && (
              <>
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.metaItem}>
                  <Phone size={11} aria-hidden /> {patient.phone}
                </span>
              </>
            )}
            {patient.email && (
              <>
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.metaItem}>
                  <Mail size={11} aria-hidden /> {patient.email}
                </span>
              </>
            )}
            {patient.bloodType && (
              <>
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.mono}>{patient.bloodType}</span>
              </>
            )}
          </div>
        </div>

        <div className={styles.heroMetrics}>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Próxima cita</div>
            <div className={`${styles.metricValue} ${hasNextAppt ? styles.brand : ""}`}>
              {hasNextAppt ? fmtShortDate(nextAppointment!.date) : "—"}
            </div>
            {hasNextAppt && nextAppointment!.startTime && (
              <div className={styles.metricSub}>
                {nextAppointment!.startTime}h{nextAppointment!.doctorName ? ` · ${nextAppointment!.doctorName}` : ""}
              </div>
            )}
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Última visita</div>
            <div className={styles.metricValue}>{lastVisitDate ? fmtShortDate(lastVisitDate) : "—"}</div>
            <div className={styles.metricSub}>{lastVisitDate ? "" : "Sin visitas"}</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Visitas totales</div>
            <div className={styles.metricValue}>{visitCount}</div>
            <div className={styles.metricSub}>{visitCount === 1 ? "consulta" : "consultas"}</div>
          </div>
        </div>

        <div className={styles.heroActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onStartConsult}
            disabled={!hasNextAppt}
            title={hasNextAppt ? "Iniciar consulta de la próxima cita" : "Agenda primero una cita para iniciar consulta"}
          >
            <Play size={13} aria-hidden /> Iniciar consulta
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onReschedule}
            title={hasNextAppt ? "Reagendar la próxima cita" : "Agendar próxima cita"}
          >
            <CalendarClock size={13} aria-hidden /> {hasNextAppt ? "Reagendar próxima" : "Agendar próxima"}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${hasBalance ? styles.btnSuccess : ""}`}
            onClick={onCharge}
            disabled={!hasBalance}
          >
            <CreditCard size={13} aria-hidden /> Cobrar {hasBalance ? formatCurrency(pendingBalance) : ""}
          </button>

          <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnIcon}`}
                aria-label="Más acciones del paciente"
                title="Más acciones"
              >
                <MoreHorizontal size={14} aria-hidden />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} className={styles.heroMenuPopover}>
                <button
                  type="button"
                  className={styles.heroMenuItem}
                  onClick={() => {
                    setMoreOpen(false);
                    onEdit();
                  }}
                >
                  <Edit size={12} aria-hidden /> Editar paciente
                </button>
                {portalUrl ? (
                  <button
                    type="button"
                    className={styles.heroMenuItem}
                    onClick={() => {
                      setMoreOpen(false);
                      navigator.clipboard.writeText(portalUrl);
                    }}
                  >
                    <ExternalLink size={12} aria-hidden /> Copiar link del portal
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.heroMenuItem}
                    onClick={() => {
                      setMoreOpen(false);
                      onEdit();
                    }}
                  >
                    <ExternalLink size={12} aria-hidden /> Generar portal paciente
                  </button>
                )}
                <button
                  type="button"
                  className={styles.heroMenuItem}
                  onClick={() => {
                    setMoreOpen(false);
                    window.print();
                  }}
                >
                  <Printer size={12} aria-hidden /> Imprimir resumen
                </button>
                <button
                  type="button"
                  className={styles.heroMenuItem}
                  onClick={() => {
                    setMoreOpen(false);
                    router.push(
                      hasNextAppt
                        ? `/dashboard/agenda?highlight=${nextAppointment!.id}`
                        : "/dashboard/agenda",
                    );
                  }}
                >
                  <Calendar size={12} aria-hidden /> Ver en agenda
                </button>
                {onExportCda && (
                  <button
                    type="button"
                    className={styles.heroMenuItem}
                    onClick={() => {
                      setMoreOpen(false);
                      onExportCda();
                    }}
                  >
                    <Download size={12} aria-hidden /> Exportar CDA HL7
                  </button>
                )}
                {onArchive && (
                  <button
                    type="button"
                    className={styles.heroMenuItem}
                    onClick={() => {
                      setMoreOpen(false);
                      onArchive();
                    }}
                  >
                    <Archive size={12} aria-hidden /> Archivar paciente
                  </button>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>

    </section>
  );
}

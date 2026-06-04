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
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ageFromDob } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
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
}: HeroCardProps) {
  const t = useT();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const age = ageFromDob(patient.dob);
  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const initials = patientInitials(patient.firstName, patient.lastName);
  const genderShort = patient.gender === "F" ? "F" : patient.gender === "M" ? "M" : "O";

  const hasBalance = pendingBalance > 0;
  const hasNextAppt = nextAppointment !== null;

  return (
    <section className={styles.hero} aria-label={t("patients.heroCard.summaryAria")}>
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
                <span className={styles.mono}>{t("patients.heroCard.ageSuffix", { age })}</span>
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
            <div className={styles.metricLabel}>{t("patients.heroCard.nextAppointment")}</div>
            {hasNextAppt ? (
              <>
                <div className={`${styles.metricValue} ${styles.brand}`}>
                  {fmtShortDate(nextAppointment!.date)}
                </div>
                {nextAppointment!.startTime && (
                  <div className={styles.metricSub}>
                    {t("patients.heroCard.timeSuffix", { time: nextAppointment!.startTime })}{nextAppointment!.doctorName ? ` · ${nextAppointment!.doctorName}` : ""}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.metricValue}>
                  <span
                    className={styles.alertChip}
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text-2)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {t("patients.heroCard.noAppointment")}
                  </span>
                </div>
                <div className={styles.metricSub}>
                  <button
                    type="button"
                    onClick={onReschedule}
                    className={styles.sideCardLink}
                  >
                    {t("patients.heroCard.schedule")} →
                  </button>
                </div>
              </>
            )}
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>{t("patients.heroCard.lastVisit")}</div>
            <div className={styles.metricValue}>{lastVisitDate ? fmtShortDate(lastVisitDate) : "—"}</div>
            <div className={styles.metricSub}>{lastVisitDate ? "" : t("patients.heroCard.noVisits")}</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>{t("patients.heroCard.totalVisits")}</div>
            <div className={styles.metricValue}>{visitCount}</div>
            <div className={styles.metricSub}>{t("patients.heroCard.consultationsLabel", { count: visitCount })}</div>
          </div>
        </div>

        <div className={styles.heroActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onStartConsult}
            disabled={!hasNextAppt}
            title={hasNextAppt ? t("patients.heroCard.startConsultTitle") : t("patients.heroCard.startConsultDisabledTitle")}
          >
            <Play size={13} aria-hidden /> {t("patients.heroCard.startConsult")}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onReschedule}
            title={hasNextAppt ? t("patients.heroCard.rescheduleTitle") : t("patients.heroCard.scheduleNextTitle")}
          >
            <CalendarClock size={13} aria-hidden /> {hasNextAppt ? t("patients.heroCard.rescheduleNext") : t("patients.heroCard.scheduleNext")}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${hasBalance ? styles.btnSuccess : ""}`}
            onClick={onCharge}
            disabled={!hasBalance}
          >
            <CreditCard size={13} aria-hidden /> {hasBalance ? t("patients.heroCard.chargeAmount", { amount: formatCurrency(pendingBalance) }) : t("patients.heroCard.charge")}
          </button>

          <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnIcon}`}
                aria-label={t("patients.heroCard.moreActionsAria")}
                title={t("patients.heroCard.moreActions")}
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
                  <Edit size={12} aria-hidden /> {t("patients.heroCard.editPatient")}
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
                    <ExternalLink size={12} aria-hidden /> {t("patients.heroCard.copyPortalLink")}
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
                    <ExternalLink size={12} aria-hidden /> {t("patients.heroCard.generatePatientPortal")}
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
                  <Printer size={12} aria-hidden /> {t("patients.heroCard.printSummary")}
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
                  <Calendar size={12} aria-hidden /> {t("patients.heroCard.viewInAgenda")}
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>

    </section>
  );
}

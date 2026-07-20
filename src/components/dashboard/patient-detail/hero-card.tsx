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
  AlertTriangle,
  Pill,
  HeartPulse,
  Check,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ageFromDob } from "@/lib/format";
import { RISK_FLAG_LABELS } from "@/lib/health-questionnaire";
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
    /** Pills clínicas de la cabecera única (antes PatientContextPanel). */
    allergies?: string[];
    currentMedications?: string[];
    chronicConditions?: string[];
  };
  /** Banderas de riesgo del cuestionario de salud vigente (pills rojas). */
  riskFlags?: string[];
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
  riskFlags = [],
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

  const allergies = patient.allergies ?? [];
  const medications = patient.currentMedications ?? [];
  const chronic = patient.chronicConditions ?? [];
  // Pills con tope visual: alergias y riesgos completos (seguridad clínica);
  // medicamentos/crónicos truncados a 2 con "+N" para no desbordar la cabecera.
  const shownMedications = medications.slice(0, 2);
  const shownChronic = chronic.slice(0, 2);
  const hiddenPills = (medications.length - shownMedications.length) + (chronic.length - shownChronic.length);

  return (
    <section className={styles.hero} aria-label={t("patients.heroCard.summaryAria")}>
      <div className={styles.heroMain}>
        <div className={styles.heroIdentity}>
          <div className={styles.heroAvatar} aria-hidden>
            {initials}
          </div>

          <div className={styles.heroInfo}>
            <div className={styles.heroTitleRow}>
              <h1 className={styles.heroName}>{fullName}</h1>
              <span className={styles.heroMeta}>
                <span className={styles.mono}>#{patient.patientNumber}</span>
                {age !== null && (
                  <>
                    <span className={styles.heroMetaSep}>·</span>
                    <span className={styles.mono}>{t("patients.heroCard.ageSuffix", { age })}</span>
                  </>
                )}
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.mono}>{genderShort}</span>
                {patient.bloodType && (
                  <>
                    <span className={styles.heroMetaSep}>·</span>
                    <span className={styles.mono}>{patient.bloodType}</span>
                  </>
                )}
              </span>
            </div>
            {(patient.phone || patient.email) && (
              <div className={styles.heroContact}>
                {patient.phone && (
                  <span className={styles.metaItem}>
                    <Phone size={13} aria-hidden /> {patient.phone}
                  </span>
                )}
                {patient.email && (
                  <span className={styles.metaItem}>
                    <Mail size={13} aria-hidden /> {patient.email}
                  </span>
                )}
              </div>
            )}
            <div className={styles.heroBadges}>
              {allergies.map((a) => (
                <span key={`al-${a}`} className={`${styles.heroBadge} ${styles.danger}`}>
                  <AlertTriangle size={12} aria-hidden /> {a}
                </span>
              ))}
              {allergies.length === 0 && (
                <span className={`${styles.heroBadge} ${styles.success}`}>
                  <Check size={12} aria-hidden /> {t("patients.heroCard.noAllergies")}
                </span>
              )}
              {riskFlags.map((f) => (
                <span key={`rf-${f}`} className={`${styles.heroBadge} ${styles.danger}`}>
                  <AlertTriangle size={12} aria-hidden /> {RISK_FLAG_LABELS[f] ?? f}
                </span>
              ))}
              {shownMedications.map((m) => (
                <span key={`med-${m}`} className={`${styles.heroBadge} ${styles.info}`}>
                  <Pill size={12} aria-hidden /> {m}
                </span>
              ))}
              {shownChronic.map((c) => (
                <span key={`cc-${c}`} className={`${styles.heroBadge} ${styles.warning}`}>
                  <HeartPulse size={12} aria-hidden /> {c}
                </span>
              ))}
              {hiddenPills > 0 && (
                <span className={styles.heroBadge}>+{hiddenPills}</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.heroSide}>
          <div className={styles.heroMetrics}>
            <div className={`${styles.metric} ${hasNextAppt ? styles.metricHighlight : ""}`}>
              <div className={styles.metricLabel}>{t("patients.heroCard.nextAppointment")}</div>
              {hasNextAppt ? (
                <>
                  <div className={`${styles.metricValue} ${styles.brand}`}>
                    {fmtShortDate(nextAppointment!.date)}
                    {nextAppointment!.startTime ? ` · ${nextAppointment!.startTime}` : ""}
                  </div>
                  {nextAppointment!.doctorName && (
                    <div className={styles.metricSub}>{nextAppointment!.doctorName}</div>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.metricValue}>
                    <span className={styles.alertChip}>
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

          <div className={styles.heroDivider} aria-hidden />

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
            <CalendarClock size={15} aria-hidden /> {hasNextAppt ? t("patients.heroCard.rescheduleNext") : t("patients.heroCard.scheduleNext")}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onCharge}
            disabled={!hasBalance}
          >
            {hasBalance
              ? <span className={styles.heroDot} aria-hidden />
              : <CreditCard size={15} aria-hidden />}
            {hasBalance ? t("patients.heroCard.chargeAmount", { amount: formatCurrency(pendingBalance) }) : t("patients.heroCard.charge")}
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
      </div>

    </section>
  );
}

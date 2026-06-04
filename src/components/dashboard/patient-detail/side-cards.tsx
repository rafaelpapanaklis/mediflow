"use client";

import Link from "next/link";
import {
  CalendarClock,
  Receipt,
  Sparkles,
  MessageCircle,
  X,
  RefreshCcw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patient-detail.module.css";

interface SideCardsProps {
  nextAppointment: {
    date: string;
    startTime: string;
    type?: string;
    doctorName?: string;
    resourceName?: string;
  } | null;
  finance: {
    total: number;
    paid: number;
    balance: number;
    pct: number;
  };
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  onReschedule: () => void;
  onCancelAppt: () => void;
  onCharge: () => void;
}

function fmtDateLong(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(iso))
    .replace(/\./g, "")
    .replace(/^./, (c) => c.toUpperCase());
}

function fmtDayNum(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric" }).format(new Date(iso));
}

function fmtMonthShort(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { month: "short" })
    .format(new Date(iso))
    .replace(/\./g, "")
    .toUpperCase();
}

export function SideCards({
  nextAppointment,
  finance,
  patientId,
  patientName,
  patientPhone,
  onReschedule,
  onCancelAppt,
  onCharge,
}: SideCardsProps) {
  const t = useT();
  return (
    <aside className={styles.sidePanel} aria-label={t("patients.sideCards.panelAria")}>
      {/* Próxima cita */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <CalendarClock size={13} aria-hidden /> {t("patients.sideCards.nextAppointment")}
          </h3>
        </header>
        {nextAppointment ? (
          <>
            <div className={styles.dateBlock}>
              <span className={styles.dateBlockDay}>{fmtDayNum(nextAppointment.date)}</span>
              <span className={styles.dateBlockMonth}>{fmtMonthShort(nextAppointment.date)}</span>
            </div>
            <div className={styles.dateBlockMeta}>
              <strong>{nextAppointment.startTime}h</strong>
              <span>· {fmtDateLong(nextAppointment.date)}</span>
            </div>
            {nextAppointment.type && (
              <div className={styles.dateBlockReason}>{nextAppointment.type}</div>
            )}
            {(nextAppointment.doctorName || nextAppointment.resourceName) && (
              <div className={styles.dateBlockSub}>
                {[nextAppointment.doctorName, nextAppointment.resourceName].filter(Boolean).join(" · ")}
              </div>
            )}
            <div className={styles.sideCardActions}>
              <button type="button" className={styles.sideBtn} onClick={onReschedule}>
                <RefreshCcw size={11} aria-hidden /> {t("patients.sideCards.reschedule")}
              </button>
              <button
                type="button"
                className={`${styles.sideBtn} ${styles.danger}`}
                onClick={onCancelAppt}
              >
                <X size={11} aria-hidden /> {t("common.cancel")}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.sideCardEmpty}>
            {t("patients.sideCards.noNextAppointment")}{" "}
            <button type="button" className={styles.sideCardLink} onClick={onReschedule}>
              {t("patients.sideCards.schedule")} →
            </button>
          </div>
        )}
      </section>

      {/* Estado de cuenta */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Receipt size={13} aria-hidden /> {t("patients.sideCards.accountStatement")}
          </h3>
        </header>
        <div className={styles.financeRow}>
          <span>{t("patients.sideCards.treatmentTotal")}</span>
          <strong>{formatCurrency(finance.total)}</strong>
        </div>
        <div className={`${styles.financeRow} ${styles.success}`}>
          <span>{t("patients.sideCards.paid")}</span>
          <strong>{formatCurrency(finance.paid)}</strong>
        </div>
        <div className={`${styles.financeRow} ${styles.danger}`}>
          <span>{t("patients.sideCards.pendingBalance")}</span>
          <strong>{formatCurrency(finance.balance)}</strong>
        </div>
        <div className={styles.financeBar}>
          <div className={styles.financeBarFill} style={{ width: `${finance.pct}%` }} />
        </div>
        <div className={styles.financeBarLabel}>{t("patients.sideCards.pctCovered", { pct: finance.pct })}</div>
        {finance.balance > 0 && (
          <button
            type="button"
            className={`${styles.sideBtn} ${styles.primary} ${styles.fullWidth}`}
            onClick={onCharge}
          >
            {t("patients.sideCards.chargeNow")} · {formatCurrency(finance.balance)}
          </button>
        )}
      </section>

      {/* Reglas automáticas */}
      <section className={`${styles.sideCard} ${styles.aiCard}`}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Sparkles size={13} aria-hidden /> {t("patients.sideCards.autoRules")}
          </h3>
        </header>
        <p className={styles.aiText}>
          {t("patients.sideCards.reminderText", { name: patientName.split(" ")[0] ?? "" })}
        </p>
      </section>

      {/* WhatsApp recientes */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <MessageCircle size={13} aria-hidden /> {t("patients.sideCards.recentWhatsApp")}
          </h3>
        </header>
        <div className={styles.waEmpty}>
          {patientPhone ? (
            <>{t("patients.sideCards.noRecentMessages", { name: patientName.split(" ")[0] ?? "" })}</>
          ) : (
            <>{t("patients.sideCards.noPhone")}</>
          )}
        </div>
        {patientPhone && (
          <Link
            href={`/dashboard/inbox?patientId=${encodeURIComponent(patientId)}`}
            className={`${styles.sideBtn} ${styles.fullWidth}`}
            style={{ textDecoration: "none" }}
          >
            {t("patients.sideCards.openChat")}
          </Link>
        )}
      </section>
    </aside>
  );
}

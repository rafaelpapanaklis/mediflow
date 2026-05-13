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
  return (
    <aside className={styles.sidePanel} aria-label="Panel lateral">
      {/* Próxima cita */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <CalendarClock size={13} aria-hidden /> Próxima cita
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
                <RefreshCcw size={11} aria-hidden /> Reagendar
              </button>
              <button
                type="button"
                className={`${styles.sideBtn} ${styles.danger}`}
                onClick={onCancelAppt}
              >
                <X size={11} aria-hidden /> Cancelar
              </button>
            </div>
          </>
        ) : (
          <div className={styles.sideCardEmpty}>
            Sin próxima cita.{" "}
            <button type="button" className={styles.sideCardLink} onClick={onReschedule}>
              Agendar →
            </button>
          </div>
        )}
      </section>

      {/* Estado de cuenta */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Receipt size={13} aria-hidden /> Estado de cuenta
          </h3>
        </header>
        <div className={styles.financeRow}>
          <span>Total tratamiento</span>
          <strong>{formatCurrency(finance.total)}</strong>
        </div>
        <div className={`${styles.financeRow} ${styles.success}`}>
          <span>Pagado</span>
          <strong>{formatCurrency(finance.paid)}</strong>
        </div>
        <div className={`${styles.financeRow} ${styles.danger}`}>
          <span>Saldo pendiente</span>
          <strong>{formatCurrency(finance.balance)}</strong>
        </div>
        <div className={styles.financeBar}>
          <div className={styles.financeBarFill} style={{ width: `${finance.pct}%` }} />
        </div>
        <div className={styles.financeBarLabel}>{finance.pct}% cubierto</div>
        {finance.balance > 0 && (
          <button
            type="button"
            className={`${styles.sideBtn} ${styles.primary} ${styles.fullWidth}`}
            onClick={onCharge}
          >
            Cobrar ahora · {formatCurrency(finance.balance)}
          </button>
        )}
      </section>

      {/* Reglas automáticas */}
      <section className={`${styles.sideCard} ${styles.aiCard}`}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Sparkles size={13} aria-hidden /> Reglas automáticas
          </h3>
        </header>
        <p className={styles.aiText}>
          {patientName.split(" ")[0]} recibirá un recordatorio por WhatsApp 24h
          antes de su próxima cita (si la clínica tiene WhatsApp activado).
        </p>
      </section>

      {/* WhatsApp recientes */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <MessageCircle size={13} aria-hidden /> WhatsApp recientes
          </h3>
        </header>
        <div className={styles.waEmpty}>
          {patientPhone ? (
            <>Sin mensajes recientes con {patientName.split(" ")[0]}.</>
          ) : (
            <>Paciente sin teléfono registrado.</>
          )}
        </div>
        {patientPhone && (
          <Link
            href={`/dashboard/inbox?patientId=${encodeURIComponent(patientId)}`}
            className={`${styles.sideBtn} ${styles.fullWidth}`}
            style={{ textDecoration: "none" }}
          >
            Abrir chat
          </Link>
        )}
      </section>
    </aside>
  );
}

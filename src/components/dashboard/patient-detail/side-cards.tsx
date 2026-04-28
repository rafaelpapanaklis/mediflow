"use client";

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

      {/* Sugerencias IA */}
      <section className={`${styles.sideCard} ${styles.aiCard}`}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Sparkles size={13} aria-hidden /> Sugerencias IA
          </h3>
        </header>
        <p className={styles.aiText}>
          {patientName.split(" ")[0]} no ha confirmado su próxima cita. Sugerencia:
          enviar recordatorio por WhatsApp 24h antes para reducir riesgo de no-show.
        </p>
        <button
          type="button"
          className={`${styles.sideBtn} ${styles.fullWidth}`}
          disabled={!patientPhone}
          title={patientPhone ?? "Sin teléfono registrado"}
        >
          <MessageCircle size={11} aria-hidden /> Enviar por WhatsApp
        </button>
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
          <a
            href={`https://wa.me/${patientPhone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.sideBtn} ${styles.fullWidth}`}
            style={{ textDecoration: "none" }}
          >
            Abrir chat
          </a>
        )}
      </section>
    </aside>
  );
}

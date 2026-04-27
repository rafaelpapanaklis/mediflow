"use client";

import { useEffect, useState } from "react";
import { Pause, CheckCircle2, X } from "lucide-react";
import styles from "./patient-detail.module.css";

export interface ConsultBarProps {
  patientName: string;
  resourceName: string | null;
  doctorName: string | null;
  /** ISO timestamp del inicio de la consulta (appointment.startedAt o startsAt como fallback). */
  startedAt: string;
  paused?: boolean;
  saving?: boolean;
  saveLabel?: string;
  onPause: () => void;
  onComplete: () => void;
  onClose?: () => void;
}

function fmtTimer(seconds: number): string {
  const s = Math.max(0, seconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function ConsultBar({
  patientName,
  resourceName,
  doctorName,
  startedAt,
  paused = false,
  saving = false,
  saveLabel,
  onPause,
  onComplete,
  onClose,
}: ConsultBarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paused]);

  const elapsed = Math.floor((now - new Date(startedAt).getTime()) / 1000);
  const timer = fmtTimer(elapsed);

  return (
    <div
      className={styles.consultBar}
      role="region"
      aria-label={`Consulta activa con ${patientName}`}
    >
      <span className={styles.consultPulse} aria-hidden />
      <span className={styles.consultStatus}>En consulta</span>
      <span className={styles.consultDivider} aria-hidden />
      <span className={styles.consultName}>{patientName}</span>
      {resourceName && (
        <>
          <span className={styles.consultDivider} aria-hidden />
          <span className={styles.consultMeta}>{resourceName}</span>
        </>
      )}
      {doctorName && (
        <>
          <span className={styles.consultDivider} aria-hidden />
          <span className={styles.consultMeta}>{doctorName}</span>
        </>
      )}
      <span className={styles.consultSpacer} />
      {saveLabel && (
        <span className={styles.consultSaveStatus}>
          {saving ? "Guardando…" : saveLabel}
        </span>
      )}
      <span className={`${styles.consultTimer} ${paused ? styles.paused : ""}`}>
        {timer}
      </span>
      <button
        type="button"
        className={styles.consultBtn}
        onClick={onPause}
        title={paused ? "Reanudar" : "Pausar timer"}
      >
        <Pause size={12} aria-hidden />
        <span>{paused ? "Reanudar" : "Pausar"}</span>
      </button>
      <button
        type="button"
        className={`${styles.consultBtn} ${styles.consultBtnComplete}`}
        onClick={onComplete}
      >
        <CheckCircle2 size={12} aria-hidden />
        <span>Completar consulta</span>
      </button>
      {onClose && (
        <button
          type="button"
          className={styles.consultClose}
          onClick={onClose}
          aria-label="Cerrar consulta"
          title="Salir de modo consulta"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

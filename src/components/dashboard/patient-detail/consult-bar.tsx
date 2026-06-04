"use client";

import { useEffect, useState } from "react";
import { Pause, CheckCircle2, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
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
  const t = useT();
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
      aria-label={t("patients.consultBar.activeWith", { patientName })}
    >
      <span className={styles.consultPulse} aria-hidden />
      <span className={styles.consultStatus}>{t("patients.consultBar.inConsultation")}</span>
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
          {saving ? t("common.saving") : saveLabel}
        </span>
      )}
      <span className={`${styles.consultTimer} ${paused ? styles.paused : ""}`}>
        {timer}
      </span>
      <button
        type="button"
        className={styles.consultBtn}
        onClick={onPause}
        title={paused ? t("patients.consultBar.resume") : t("patients.consultBar.pauseTimer")}
      >
        <Pause size={12} aria-hidden />
        <span>{paused ? t("patients.consultBar.resume") : t("patients.consultBar.pause")}</span>
      </button>
      <button
        type="button"
        className={`${styles.consultBtn} ${styles.consultBtnComplete}`}
        onClick={onComplete}
      >
        <CheckCircle2 size={12} aria-hidden />
        <span>{t("patients.consultBar.completeConsultation")}</span>
      </button>
      {onClose && (
        <button
          type="button"
          className={styles.consultClose}
          onClick={onClose}
          aria-label={t("patients.consultBar.closeConsultation")}
          title={t("patients.consultBar.exitConsultationMode")}
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

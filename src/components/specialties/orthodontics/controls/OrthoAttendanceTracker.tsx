"use client";
// Orthodontics — UI dedicada al cumplimiento de citas (% asistencia,
// no-shows, alerta drop-risk). Lee la lista de controles y muestra
// métricas por ventana temporal: último mes, últimos 3 meses, total.

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type { OrthodonticControlAppointmentRow } from "@/lib/types/orthodontics";
import { summarizeCompliance, hasDropRisk } from "@/lib/orthodontics/compliance-helpers";

export interface OrthoAttendanceTrackerProps {
  controls: OrthodonticControlAppointmentRow[];
}

interface WindowMetrics {
  total: number;
  attended: number;
  noShow: number;
  rescheduled: number;
  attendanceRate: number;
}

const WINDOW_LABEL: Record<string, string> = {
  last30: "Último mes",
  last90: "Últimos 3 meses",
  total: "Histórico total",
};

export function OrthoAttendanceTracker(props: OrthoAttendanceTrackerProps) {
  const { byWindow, summary, consecutiveNoShows } = useMemo(() => {
    const sorted = [...props.controls].sort(
      (a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime(),
    );
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const last30 = sorted.filter((c) => now - c.scheduledAt.getTime() <= 30 * day);
    const last90 = sorted.filter((c) => now - c.scheduledAt.getTime() <= 90 * day);

    const compute = (rows: OrthodonticControlAppointmentRow[]): WindowMetrics => {
      const total = rows.length;
      const attended = rows.filter((r) => r.attendance === "ATTENDED").length;
      const noShow = rows.filter((r) => r.attendance === "NO_SHOW").length;
      const rescheduled = rows.filter((r) => r.attendance === "RESCHEDULED").length;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
      return { total, attended, noShow, rescheduled, attendanceRate };
    };

    // Cuenta NO_SHOW consecutivos al frente.
    let consecutive = 0;
    for (const c of sorted) {
      if (c.attendance === "NO_SHOW") consecutive++;
      else break;
    }

    return {
      byWindow: {
        last30: compute(last30),
        last90: compute(last90),
        total: compute(sorted),
      },
      summary: summarizeCompliance(sorted),
      consecutiveNoShows: consecutive,
    };
  }, [props.controls]);

  const dropRisk = hasDropRisk(summary) || consecutiveNoShows >= 2;

  return (
    <section
      style={{
        background: "var(--surface-1, #ffffff)",
        border: "1px solid var(--border, #e5e5ed)",
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
      aria-label="Cumplimiento de asistencia"
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <h3 style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>
          Asistencia · cumplimiento
        </h3>
        {summary.level === "ok" ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--success, #10b981)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CheckCircle2 size={12} aria-hidden /> 3/3 últimas atendidas
          </span>
        ) : summary.level === "insufficient" ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-2, #6b6b78)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Clock size={12} aria-hidden /> Datos insuficientes
          </span>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: dropRisk ? "var(--danger, #ef4444)" : "var(--warning, #d97706)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <AlertTriangle size={12} aria-hidden />
            {summary.attended}/3 últimas atendidas
          </span>
        )}
      </header>

      {dropRisk ? (
        <div
          role="alert"
          style={{
            padding: 10,
            background: "var(--danger-soft, rgba(239,68,68,0.10))",
            color: "var(--danger, #ef4444)",
            borderRadius: 6,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <AlertTriangle size={14} aria-hidden />
          {consecutiveNoShows >= 2
            ? `Riesgo de drop: ${consecutiveNoShows} faltas consecutivas. Llamar al paciente.`
            : "Riesgo de drop: 0/3 últimas citas atendidas. Iniciar protocolo de retención."}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 8,
        }}
      >
        {(["last30", "last90", "total"] as const).map((key) => {
          const m = byWindow[key];
          return (
            <div
              key={key}
              style={{
                background: "var(--surface-2, #f5f5f7)",
                border: "1px solid var(--border, #e5e5ed)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <small style={{ fontSize: 11, color: "var(--text-2, #6b6b78)" }}>
                {WINDOW_LABEL[key]}
              </small>
              <strong
                style={{
                  fontSize: 22,
                  color: rateColor(m.attendanceRate),
                }}
              >
                {m.attendanceRate}%
              </strong>
              <small style={{ fontSize: 11, color: "var(--text-2, #6b6b78)" }}>
                {m.attended} atendidas · {m.noShow} no-show · {m.rescheduled}{" "}
                reagendadas
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function rateColor(pct: number): string {
  if (pct >= 80) return "var(--success, #10b981)";
  if (pct >= 50) return "var(--warning, #d97706)";
  return "var(--danger, #ef4444)";
}

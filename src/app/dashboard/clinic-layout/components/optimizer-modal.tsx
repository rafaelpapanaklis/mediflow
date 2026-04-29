"use client";

import { useState } from "react";
import { Sparkles, X, Check, RefreshCw } from "lucide-react";
import type { LiveAppointment } from "@/lib/floor-plan/elements";
import styles from "./optimizer-modal.module.css";

interface ChairInfo {
  id: string;
  name: string;
}

interface OptimizedAppt {
  resourceId: string;
  patient: string;
  treatment: string;
  doctor: string;
  startHour: number;
  startMin: number;
  durationMins: number;
  /** Derivado en cliente para timeline. */
  start?: Date;
  end?: Date;
}

interface OptimizerResult {
  optimized: OptimizedAppt[];
  stats: {
    deadTimeSavedMins: number;
    extraPatientsCapacity: number;
    efficiency: number;
  };
  reasoning: string;
}

type Phase = "idle" | "thinking" | "done" | "error";

const TL_START_H = 8;
const TL_END_H = 20;
const TL_TOTAL_MIN = (TL_END_H - TL_START_H) * 60;

function fmtT(d: Date): string {
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function minsFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
function toFrac(d: Date): number {
  return Math.max(0, Math.min(1, (minsFromMidnight(d) - TL_START_H * 60) / TL_TOTAL_MIN));
}

interface MiniLaneProps {
  chairName: string;
  appointments: Array<{ start: Date; end: Date; patient: string }>;
  highlight?: boolean;
}

function MiniLane({ chairName, appointments, highlight }: MiniLaneProps) {
  return (
    <div className={styles.lane}>
      <div className={styles.laneLabel}>{chairName}</div>
      <div className={styles.laneRail}>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className={styles.laneTick} style={{ left: `${(i / 12) * 100}%` }} />
        ))}
        {appointments.map((apt, i) => {
          const sf = toFrac(apt.start);
          const ef = toFrac(apt.end);
          return (
            <div
              key={i}
              className={`${styles.laneBlock} ${highlight ? styles.laneBlockChanged : ""}`}
              style={{ left: `${sf * 100}%`, width: `${(ef - sf) * 100}%` }}
              title={`${apt.patient} · ${fmtT(apt.start)}–${fmtT(apt.end)}`}
            >
              <span>{apt.patient}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HourLabels() {
  return (
    <div className={styles.hours}>
      <span style={{ width: 116 }} />
      <div className={styles.hoursInner}>
        {Array.from({ length: 13 }, (_, i) => (
          <span key={i}>{(TL_START_H + i).toString().padStart(2, "0")}:00</span>
        ))}
      </div>
    </div>
  );
}

interface StatBadgeProps {
  label: string;
  value: string;
  variant: "green" | "blue" | "violet";
}

function StatBadge({ label, value, variant }: StatBadgeProps) {
  return (
    <div className={`${styles.stat} ${styles[`stat_${variant}`]}`}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

interface Props {
  appointments: LiveAppointment[];
  chairs: ChairInfo[];
  onClose: () => void;
}

export function OptimizerModal({ appointments, chairs, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [applied, setApplied] = useState(false);

  const chairById = new Map(chairs.map((c) => [c.id, c]));

  const byChair: Record<string, LiveAppointment[]> = {};
  for (const c of chairs) byChair[c.id] = [];
  for (const a of appointments) {
    if (a.resourceId && byChair[a.resourceId]) {
      byChair[a.resourceId].push(a);
    }
  }
  for (const k of Object.keys(byChair)) {
    byChair[k].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async function runOptimizer() {
    setPhase("thinking");
    setErrorMsg("");
    setResult(null);
    try {
      const res = await fetch("/api/clinic-layout/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const r = data.result as OptimizerResult;
      // Hidratar Date desde {startHour, startMin}.
      const today = new Date();
      r.optimized = (r.optimized ?? []).map((a) => {
        const start = new Date(today);
        start.setHours(a.startHour, a.startMin || 0, 0, 0);
        const end = new Date(start.getTime() + a.durationMins * 60_000);
        return { ...a, start, end };
      });
      setResult(r);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "error_desconocido");
      setPhase("error");
    }
  }

  const optimizedByChair: Record<string, OptimizedAppt[]> = {};
  if (result) {
    for (const c of chairs) optimizedByChair[c.id] = [];
    for (const a of result.optimized) {
      if (optimizedByChair[a.resourceId]) optimizedByChair[a.resourceId].push(a);
    }
    for (const k of Object.keys(optimizedByChair)) {
      optimizedByChair[k].sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Optimizador de agenda con IA"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.headerIcon}>
            <Sparkles size={22} aria-hidden />
          </span>
          <div className={styles.headerText}>
            <div className={styles.headerTitle}>Optimizador de Agenda con IA</div>
            <div className={styles.headerSubtitle}>
              Analiza y reorganiza las citas del día para maximizar eficiencia
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Agenda Actual</div>
            <HourLabels />
            {chairs.map((c) => (
              <MiniLane
                key={c.id}
                chairName={c.name}
                appointments={(byChair[c.id] ?? []).map((a) => ({
                  start: a.start,
                  end: a.end,
                  patient: a.patient.split(" ")[0],
                }))}
              />
            ))}
            {chairs.length === 0 && (
              <div className={styles.empty}>No hay sillones registrados en la agenda.</div>
            )}
          </div>

          {phase === "thinking" && (
            <div className={styles.thinking}>
              <div className={styles.dots}>
                <span /><span /><span />
              </div>
              <div className={styles.thinkingTitle}>La IA está analizando tu agenda…</div>
              <div className={styles.thinkingSub}>
                Identificando tiempos muertos y oportunidades de optimización
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className={styles.error}>Error al procesar: {errorMsg}</div>
          )}

          {phase === "done" && result && (
            <>
              <div className={styles.stats}>
                <StatBadge
                  label="Tiempo muerto ahorrado"
                  value={`${result.stats.deadTimeSavedMins} min`}
                  variant="green"
                />
                <StatBadge
                  label="Pacientes adicionales"
                  value={`+${result.stats.extraPatientsCapacity}`}
                  variant="blue"
                />
                <StatBadge
                  label="Eficiencia del día"
                  value={`${result.stats.efficiency}%`}
                  variant="violet"
                />
              </div>

              <div className={styles.reasoning}>
                <strong>Cambios realizados:</strong> {result.reasoning}
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Agenda Optimizada
                  <span className={styles.sectionBadge}>Nueva</span>
                </div>
                <HourLabels />
                {chairs.map((c) => (
                  <MiniLane
                    key={c.id}
                    chairName={c.name}
                    highlight
                    appointments={(optimizedByChair[c.id] ?? [])
                      .filter((a) => a.start && a.end)
                      .map((a) => ({
                        start: a.start as Date,
                        end: a.end as Date,
                        patient: a.patient.split(" ")[0],
                      }))}
                  />
                ))}
              </div>

              <div className={styles.diff}>
                <div className={styles.diffHeader}>
                  <span>Paciente</span>
                  <span>Antes</span>
                  <span className={styles.diffHeaderAfter}>Optimizado</span>
                </div>
                {result.optimized.map((apt, i) => {
                  const orig = appointments.find((a) => a.patient === apt.patient);
                  const origChair = orig
                    ? chairById.get(orig.resourceId ?? "")?.name ?? "—"
                    : "—";
                  const newChair = chairById.get(apt.resourceId)?.name ?? "—";
                  const changed =
                    !!orig &&
                    apt.start &&
                    (fmtT(orig.start) !== fmtT(apt.start) || origChair !== newChair);
                  return (
                    <div
                      key={i}
                      className={`${styles.diffRow} ${changed ? styles.diffRowChanged : ""}`}
                    >
                      <span className={styles.diffPatient}>{apt.patient}</span>
                      <span className={styles.diffBefore}>
                        {orig ? `${fmtT(orig.start)} · ${origChair}` : "—"}
                      </span>
                      <span className={styles.diffAfter}>
                        {apt.start ? `${fmtT(apt.start)} · ${newChair}` : "—"}
                        {changed && <span className={styles.changeBadge}>Cambio</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cerrar
          </button>
          {phase === "idle" && (
            <button type="button" className={styles.btnPrimary} onClick={runOptimizer}>
              <Sparkles size={13} aria-hidden /> Optimizar con IA
            </button>
          )}
          {phase === "error" && (
            <button type="button" className={styles.btnPrimary} onClick={runOptimizer}>
              <RefreshCw size={13} aria-hidden /> Reintentar
            </button>
          )}
          {phase === "done" && !applied && (
            <button
              type="button"
              className={styles.btnSuccess}
              onClick={() => {
                setApplied(true);
                alert(
                  "Optimización aplicada visualmente. La actualización masiva de citas requiere confirmación adicional (TODO: endpoint de aplicación).",
                );
              }}
            >
              <Check size={13} aria-hidden /> Aplicar
            </button>
          )}
          {phase === "done" && (
            <button type="button" className={styles.btnRegen} onClick={runOptimizer}>
              Regenerar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

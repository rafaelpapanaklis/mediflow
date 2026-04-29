"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, ExternalLink, FileText } from "lucide-react";
import { toScreen } from "@/lib/floor-plan/iso";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  type ChairStatus,
  type LayoutElement,
  type LiveAppointment,
} from "@/lib/floor-plan/elements";
import {
  appointmentProgress,
  fmtHM,
  fmtHMS,
  getChairAppointment,
  getChairStatus,
  getNextChairAppointment,
  maskPatient,
  timelineFraction,
  timelineFractionToDate,
  TIMELINE_END_HOUR,
  TIMELINE_START_HOUR,
} from "@/lib/floor-plan/live-mode";
import liveStyles from "./live-mode.module.css";

interface ChairInfo {
  id: string;
  name: string;
  color: string | null;
}

/* ─────────────────── LiveOverlay (halos + figuras) ───────────────────
 * Renderizado dentro del SVG principal del editor. Para cada elemento
 * isChair con resourceId asignado, dibuja un halo ellipse coloreado por
 * estado y, si está ocupado, una figura humana sobre el sillón.
 */
export function LiveOverlay({
  elements,
  ox,
  oy,
  viewTime,
  appointments,
  showFullNames,
  onHover,
}: {
  elements: LayoutElement[];
  ox: number;
  oy: number;
  viewTime: Date;
  appointments: LiveAppointment[];
  showFullNames: boolean;
  onHover: (data: HoverData | null) => void;
}) {
  return (
    <g pointerEvents="all">
      {elements.map((el) => {
        if (!el.resourceId) return null;
        const status = getChairStatus(el.resourceId, viewTime, appointments);
        const color = STATUS_COLORS[status];
        const apt = getChairAppointment(el.resourceId, viewTime, appointments);
        // Centro aproximado del sillón en pantalla (col+1, row+1.5).
        const [cx, cy] = toScreen(el.col + 1, el.row + 1.5, ox, oy);
        const haloY = cy - 24;
        return (
          <g
            key={el.id}
            onMouseEnter={(e) => {
              if (apt) {
                onHover({
                  appointment: apt,
                  status,
                  showFullNames,
                  x: e.clientX,
                  y: e.clientY,
                  viewTime,
                });
              }
            }}
            onMouseMove={(e) =>
              apt &&
              onHover({
                appointment: apt,
                status,
                showFullNames,
                x: e.clientX,
                y: e.clientY,
                viewTime,
              })
            }
            onMouseLeave={() => onHover(null)}
          >
            {/* Halo difuminado exterior */}
            <ellipse
              cx={cx}
              cy={haloY}
              rx={68}
              ry={34}
              fill={color}
              opacity={0.15}
              filter="url(#mfHaloBlur)"
            />
            {/* Anillo sólido animado si ocupado */}
            <ellipse
              cx={cx}
              cy={haloY}
              rx={48}
              ry={24}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              opacity={status === "ocupado" ? 0.9 : 0.5}
            >
              {status === "ocupado" && (
                <>
                  <animate attributeName="rx" values="48;58;48" dur="1.7s" repeatCount="indefinite" />
                  <animate attributeName="ry" values="24;29;24" dur="1.7s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0.2;0.9" dur="1.7s" repeatCount="indefinite" />
                </>
              )}
            </ellipse>
            {/* Indicador sobre la lámpara del sillón */}
            <circle cx={cx} cy={haloY - 56} r={9} fill={color} opacity={0.2}>
              {status === "ocupado" && (
                <>
                  <animate attributeName="r" values="9;13;9" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.2;0.05;0.2" dur="1.2s" repeatCount="indefinite" />
                </>
              )}
            </circle>
            <circle cx={cx} cy={haloY - 56} r={5.5} fill={color}>
              {status === "ocupado" && (
                <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
              )}
            </circle>
            {/* Figura humana — solo ocupados */}
            {status === "ocupado" && (
              <PatientFigure
                cx={toScreen(el.col + 0.85, el.row + 0.75, ox, oy)[0]}
                cy={toScreen(el.col + 0.85, el.row + 0.75, ox, oy)[1] - 22}
              />
            )}
          </g>
        );
      })}
      {/* Filter de blur reusable */}
      <defs>
        <filter id="mfHaloBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>
    </g>
  );
}

function PatientFigure({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy - 9} rx={6} ry={3.5} fill="#5C3D1E" />
      <circle cx={cx} cy={cy - 9} r={6.5} fill="#F5CBA7" stroke="#D4956A" strokeWidth={0.8} />
      <ellipse cx={cx} cy={cy + 4} rx={9} ry={13} fill="#4A90E2" />
      <path d={`M${cx - 6} ${cy - 4} Q${cx} ${cy - 1} ${cx + 6} ${cy - 4}`} stroke="#fff" strokeWidth={2} fill="none" opacity={0.8} />
      <ellipse cx={cx - 4} cy={cy + 16} rx={4} ry={7} fill="#1E3A5F" opacity={0.9} />
      <ellipse cx={cx + 4} cy={cy + 16} rx={4} ry={7} fill="#1E3A5F" opacity={0.9} />
    </g>
  );
}

/* ─────────────────── LiveTooltip (hover) ─────────────────── */

export interface HoverData {
  appointment: LiveAppointment;
  status: ChairStatus;
  showFullNames: boolean;
  x: number;
  y: number;
  viewTime: Date;
}

export function LiveTooltip({ data }: { data: HoverData | null }) {
  if (!data) return null;
  const { appointment: a, status, showFullNames, x, y, viewTime } = data;
  const color = STATUS_COLORS[status];
  const progress = appointmentProgress(a, viewTime) * 100;
  const patient = maskPatient(a.patient, showFullNames);
  return (
    <div
      className={liveStyles.tooltip}
      style={{
        left: x + 16,
        top: y - 8,
        borderTopColor: color,
        borderColor: `${color}55`,
      }}
    >
      <div className={liveStyles.tooltipBadge}>
        <span style={{ background: color }} />
        {STATUS_LABELS[status]}
      </div>
      <div className={liveStyles.tooltipPatient}>{patient}</div>
      <div className={liveStyles.tooltipMeta}>{a.treatment}</div>
      <div className={liveStyles.tooltipTime}>
        {fmtHM(a.start)} – {fmtHM(a.end)}
      </div>
      <div className={liveStyles.tooltipBar}>
        <div style={{ width: `${progress}%`, background: color }} />
      </div>
      <div className={liveStyles.tooltipDoctor}>{a.doctor}</div>
    </div>
  );
}

/* ─────────────────── LiveClock ─────────────────── */

export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={liveStyles.clock}>
      <Clock size={13} aria-hidden style={{ color: "#EF4444" }} />
      <span>{fmtHMS(now)}</span>
    </span>
  );
}

/* ─────────────────── LiveStatusPanel (panel derecho) ─────────────────── */

export function LiveStatusPanel({
  elements,
  chairs,
  viewTime,
  appointments,
  showFullNames,
  onOpenOdontogram,
}: {
  elements: LayoutElement[];
  chairs: ChairInfo[];
  viewTime: Date;
  appointments: LiveAppointment[];
  showFullNames: boolean;
  /**
   * Si está presente, cada tarjeta con cita activa muestra un botón "Abrir
   * odontograma". El consumer recibe la cita (incluye `patientId` cuando el
   * backend lo hidrata) y decide cómo navegar — modal, link o tab nuevo.
   */
  onOpenOdontogram?: (apt: LiveAppointment) => void;
}) {
  const placedChairs = useMemo(
    () =>
      elements
        .filter((e) => e.resourceId)
        .map((e) => {
          const chair = chairs.find((c) => c.id === e.resourceId);
          return chair ? { resourceId: e.resourceId!, name: chair.name } : null;
        })
        .filter((c): c is { resourceId: string; name: string } => c !== null),
    [elements, chairs],
  );

  if (placedChairs.length === 0) {
    return (
      <div className={liveStyles.statusEmpty}>
        Asigna sillones a los elementos del layout para verlos aquí.
      </div>
    );
  }

  return (
    <div className={liveStyles.statusList}>
      {placedChairs.map((c) => {
        const status = getChairStatus(c.resourceId, viewTime, appointments);
        const color = STATUS_COLORS[status];
        const apt = getChairAppointment(c.resourceId, viewTime, appointments);
        const next = getNextChairAppointment(c.resourceId, viewTime, appointments);
        const progress = apt ? appointmentProgress(apt, viewTime) * 100 : 0;
        return (
          <div
            key={c.resourceId}
            className={liveStyles.statusCard}
            style={{ borderColor: `${color}33`, background: `${color}08` }}
          >
            <div className={liveStyles.statusCardHeader} style={{ background: `${color}18` }}>
              <span className={liveStyles.statusCardName}>{c.name}</span>
              <span className={liveStyles.statusCardBadge} style={{ color }}>
                <span style={{ background: color }} />
                {STATUS_LABELS[status]}
              </span>
            </div>
            <div className={liveStyles.statusCardBody}>
              {apt ? (
                <>
                  <div className={liveStyles.statusPatient}>{maskPatient(apt.patient, showFullNames)}</div>
                  <div className={liveStyles.statusTreatment}>{apt.treatment}</div>
                  <div className={liveStyles.statusBar}>
                    <div style={{ width: `${progress}%`, background: color }} />
                  </div>
                  <div className={liveStyles.statusFooter}>
                    {apt.doctor} · {fmtHM(apt.start)}–{fmtHM(apt.end)}
                  </div>
                  {onOpenOdontogram && (
                    <button
                      type="button"
                      className={liveStyles.statusOdontogramBtn}
                      onClick={() => onOpenOdontogram(apt)}
                      title="Abrir expediente / odontograma"
                    >
                      <FileText size={11} aria-hidden /> Odontograma
                    </button>
                  )}
                </>
              ) : next ? (
                <>
                  <div className={liveStyles.statusPatient}>{maskPatient(next.patient, showFullNames)}</div>
                  <div className={liveStyles.statusTreatment}>{next.treatment}</div>
                  <div className={liveStyles.statusFooter}>
                    Próxima · {fmtHM(next.start)}
                  </div>
                </>
              ) : (
                <div className={liveStyles.statusFree}>Sin citas pendientes</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────── Timeline ─────────────────── */

export function LiveTimeline({
  elements,
  chairs,
  viewTime,
  appointments,
  onSeek,
  onResetNow,
}: {
  elements: LayoutElement[];
  chairs: ChairInfo[];
  viewTime: Date;
  appointments: LiveAppointment[];
  onSeek: (d: Date) => void;
  onResetNow: () => void;
}) {
  const now = new Date();
  const nowFrac = timelineFraction(now);
  const viewFrac = timelineFraction(viewTime);
  const isPast = Math.abs(now.getTime() - viewTime.getTime()) > 90_000;

  const placedChairs = useMemo(
    () =>
      elements
        .filter((e) => e.resourceId)
        .map((e) => {
          const chair = chairs.find((c) => c.id === e.resourceId);
          return chair ? { resourceId: e.resourceId!, name: chair.name } : null;
        })
        .filter((c): c is { resourceId: string; name: string } => c !== null),
    [elements, chairs],
  );

  const hours = Array.from(
    { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
    (_, i) => TIMELINE_START_HOUR + i,
  );

  const handleClickRail = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(timelineFractionToDate(frac, viewTime));
  };

  return (
    <div className={liveStyles.timeline}>
      <div className={liveStyles.timelineHeader}>
        <span className={liveStyles.timelineTitle}>Agenda del día</span>
        <span className={liveStyles.timelineLegend}>
          <span><span style={{ background: STATUS_COLORS.ocupado }} /> Ocupado</span>
          <span><span style={{ background: STATUS_COLORS.proximo }} /> Próximo</span>
          <span><span style={{ background: STATUS_COLORS.libre }} /> Libre</span>
        </span>
        {isPast && (
          <button
            type="button"
            className={liveStyles.timelineNowBtn}
            onClick={onResetNow}
          >
            ↻ Volver a ahora
          </button>
        )}
      </div>
      <div className={liveStyles.timelineHours}>
        <div style={{ width: 108 }} />
        <div className={liveStyles.timelineHoursInner}>
          {hours.map((h) => (
            <span key={h}>{h.toString().padStart(2, "0")}:00</span>
          ))}
        </div>
      </div>
      {placedChairs.map((c) => (
        <div key={c.resourceId} className={liveStyles.timelineRow}>
          <span className={liveStyles.timelineLabel}>{c.name}</span>
          <div
            className={liveStyles.timelineRail}
            onClick={handleClickRail}
            role="button"
            tabIndex={0}
          >
            {/* Bloques de citas */}
            {appointments
              .filter((a) => a.resourceId === c.resourceId)
              .map((a) => {
                const startFrac = timelineFraction(a.start);
                const endFrac = timelineFraction(a.end);
                const left = startFrac * 100;
                const width = Math.max(1, (endFrac - startFrac) * 100);
                const status = getChairStatus(c.resourceId, viewTime, appointments);
                const apt = getChairAppointment(c.resourceId, viewTime, appointments);
                const isActive = apt?.id === a.id;
                const color = isActive
                  ? STATUS_COLORS.ocupado
                  : a.start.getTime() > viewTime.getTime() &&
                    a.start.getTime() - viewTime.getTime() <= 30 * 60_000
                  ? STATUS_COLORS.proximo
                  : STATUS_COLORS.libre;
                return (
                  <div
                    key={a.id}
                    className={liveStyles.timelineBlock}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: color,
                      opacity: isActive ? 1 : 0.65,
                    }}
                    title={`${a.patient} · ${fmtHM(a.start)}–${fmtHM(a.end)}`}
                  >
                    <span>{a.patient.split(" ")[0]}</span>
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      {/* Marcador "Ahora" */}
      <div className={liveStyles.timelineMarkerNow} style={{ left: `calc(108px + ${nowFrac} * (100% - 108px))` }} aria-hidden>
        <span />
      </div>
      {/* Marcador "Viendo" si != ahora */}
      {isPast && (
        <div
          className={liveStyles.timelineMarkerView}
          style={{ left: `calc(108px + ${viewFrac} * (100% - 108px))` }}
          aria-hidden
        >
          <span />
        </div>
      )}
    </div>
  );
}

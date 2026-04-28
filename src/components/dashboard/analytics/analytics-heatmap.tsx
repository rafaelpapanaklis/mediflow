"use client";

import { useState } from "react";

/**
 * AnalyticsHeatmap — grid Día (filas) × Hora (columnas) sin librería
 * externa. Cada celda recibe value 0-100+ (% de ocupación). El color
 * va de verde claro a morado oscuro según rango. Hover muestra tooltip
 * con el valor exacto + label de la celda.
 *
 * data: 7 filas (lun-dom) × N columnas (horas configurables).
 * Cada cell: { value: number, label?: string, count?: number }.
 */

export interface HeatmapCell {
  value: number;       // 0-100+ (%, puede pasar 100 = overbooking)
  count?: number;      // citas en ese slot (para tooltip)
  label?: string;      // label adicional (ej. nombre del sillón)
}

interface Props {
  data: HeatmapCell[][];   // [day][hour]
  hours: number[];          // ej. [8, 9, 10, ..., 19]
  daysES?: string[];        // override días default
  onCellClick?: (day: number, hourIdx: number, cell: HeatmapCell) => void;
}

const DAYS_DEFAULT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function AnalyticsHeatmap({ data, hours, daysES = DAYS_DEFAULT, onCellClick }: Props) {
  const [hover, setHover] = useState<{ day: number; hour: number; cell: HeatmapCell; x: number; y: number } | null>(null);

  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: 18,
        position: "relative",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      {/* Header con horas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `42px repeat(${hours.length}, 1fr)`,
          gap: 2,
          marginBottom: 4,
        }}
      >
        <div />
        {hours.map((h) => (
          <div
            key={h}
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--text-3)",
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {h.toString().padStart(2, "0")}
          </div>
        ))}
      </div>

      {/* Grid días × horas */}
      {data.map((row, dayIdx) => (
        <div
          key={dayIdx}
          style={{
            display: "grid",
            gridTemplateColumns: `42px repeat(${hours.length}, 1fr)`,
            gap: 2,
            marginBottom: 2,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-2)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {daysES[dayIdx]}
          </div>
          {row.map((cell, hourIdx) => {
            const tone = cellTone(cell.value);
            return (
              <button
                key={hourIdx}
                type="button"
                onClick={() => onCellClick?.(dayIdx, hourIdx, cell)}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setHover({
                    day: dayIdx,
                    hour: hours[hourIdx]!,
                    cell,
                    x: rect.left + rect.width / 2,
                    y: rect.top - 8,
                  });
                }}
                onMouseLeave={() => setHover(null)}
                style={{
                  height: 28,
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                  borderRadius: 4,
                  cursor: onCellClick ? "pointer" : "default",
                  padding: 0,
                  transition: "transform 0.08s",
                }}
                aria-label={`${daysES[dayIdx]} ${hours[hourIdx]}h: ${cell.value}% ocupación`}
              />
            );
          })}
        </div>
      ))}

      {/* Leyenda */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--border-soft)",
          fontSize: 11,
          color: "var(--text-3)",
        }}
      >
        <span>Ocupación:</span>
        {[
          { label: "<30%", tone: cellTone(15) },
          { label: "30-70%", tone: cellTone(50) },
          { label: "70-100%", tone: cellTone(85) },
          { label: ">100%", tone: cellTone(110) },
        ].map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: l.tone.bg,
                border: `1px solid ${l.tone.border}`,
              }}
              aria-hidden
            />
            {l.label}
          </span>
        ))}
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: hover.x,
            top: hover.y,
            transform: "translate(-50%, -100%)",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 11,
            color: "var(--text-1)",
            boxShadow: "0 8px 24px -8px rgba(15, 10, 30, 0.4)",
            pointerEvents: "none",
            zIndex: 100,
            whiteSpace: "nowrap",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          }}
        >
          <strong>
            {daysES[hover.day]} · {hover.hour.toString().padStart(2, "0")}:00
          </strong>
          <div style={{ marginTop: 2, color: "var(--text-3)" }}>
            {hover.cell.value}% ocupación
            {hover.cell.count != null && ` · ${hover.cell.count} citas`}
          </div>
          {hover.cell.label && <div style={{ color: "var(--text-3)" }}>{hover.cell.label}</div>}
        </div>
      )}
    </div>
  );
}

function cellTone(value: number) {
  // Color scale: verde (low) → ámbar → rojo → morado (overbooking).
  if (value === 0)      return { bg: "var(--bg-elev-2)",            border: "var(--border-soft)" };
  if (value < 30)       return { bg: "rgba(16, 185, 129, 0.15)",    border: "rgba(16, 185, 129, 0.30)" };
  if (value < 50)       return { bg: "rgba(132, 204, 22, 0.20)",    border: "rgba(132, 204, 22, 0.40)" };
  if (value < 70)       return { bg: "rgba(217, 119, 6, 0.22)",     border: "rgba(217, 119, 6, 0.45)" };
  if (value < 100)      return { bg: "rgba(220, 38, 38, 0.25)",     border: "rgba(220, 38, 38, 0.50)" };
  return                       { bg: "rgba(124, 58, 237, 0.40)",    border: "rgba(124, 58, 237, 0.65)" };
}

"use client";

/**
 * NoShowRiskBadge — pill que muestra dot rojo/ámbar/verde según
 * NoShowPrediction.probability del appointment. Solo se renderiza si
 * hay predicción persistida; si no, devuelve null (no badge).
 *
 * Levels:
 *  - p >= 0.6  → rojo "Alto riesgo"
 *  - p >= 0.4  → ámbar "Riesgo medio"
 *  - p < 0.4   → no badge (no vale la pena el ruido visual)
 *
 * Uso pensado: dentro de agenda-appointment-card o lista de citas.
 * Con onClick abre modal con factors + acción "Enviar recordatorio WA".
 */

interface Props {
  probability: number; // 0..1
  onClick?: () => void;
  compact?: boolean;
}

export function NoShowRiskBadge({ probability, onClick, compact }: Props) {
  if (probability < 0.4) return null;

  const isHigh = probability >= 0.6;
  const tone = isHigh ? HIGH : MEDIUM;
  const label = isHigh ? "Alto riesgo" : "Riesgo";
  const pct = Math.round(probability * 100);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Probabilidad de no-show: ${pct}%`}
      aria-label={`${label} de no-show: ${pct}%`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: compact ? "1px 6px" : "2px 8px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 999,
        fontSize: compact ? 9.5 : 10.5,
        fontWeight: 600,
        color: tone.fg,
        cursor: onClick ? "pointer" : "default",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        lineHeight: 1.3,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone.fg,
        }}
      />
      {pct}%
    </button>
  );
}

const HIGH = {
  bg: "rgba(220, 38, 38, 0.12)",
  border: "rgba(220, 38, 38, 0.30)",
  fg: "#dc2626",
};
const MEDIUM = {
  bg: "rgba(217, 119, 6, 0.12)",
  border: "rgba(217, 119, 6, 0.30)",
  fg: "#d97706",
};

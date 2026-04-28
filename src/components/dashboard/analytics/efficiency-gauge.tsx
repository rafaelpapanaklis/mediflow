"use client";

/**
 * EfficiencyGauge — dial 0-100 con arco coloreado y mensaje motivacional.
 * Score = ((horas activas / horas operativas) * 0.6) + ((slots usados /
 * slots totales) * 0.4) * 100. Calculado server-side, este componente
 * solo lo visualiza.
 *
 * Tone:
 *  - rojo  <50
 *  - ámbar 50-69
 *  - amarillo 70-84
 *  - verde 85-100
 */

interface Props {
  score: number;            // 0-100
  monthAverage?: number;    // 0-100, opcional para mostrar delta
  label?: string;
}

export function EfficiencyGauge({ score, monthAverage, label = "Eficiencia operativa" }: Props) {
  const safe = Math.max(0, Math.min(100, score));
  const tone = scoreTone(safe);
  const delta = monthAverage != null ? Math.round(safe - monthAverage) : null;

  // Arc geometry: medio círculo de 180° (de izquierda a derecha por arriba).
  const cx = 120;
  const cy = 120;
  const r = 95;
  const startAngle = 180;       // izquierda
  const endAngle   = 360;       // derecha (recorre por arriba)
  const fillAngle  = startAngle + (endAngle - startAngle) * (safe / 100);

  const arcPath = describeArc(cx, cy, r, startAngle, fillAngle);
  const bgPath  = describeArc(cx, cy, r, startAngle, endAngle);

  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-3)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          alignSelf: "flex-start",
        }}
      >
        {label}
      </div>
      <div style={{ position: "relative", width: 240, height: 140 }}>
        <svg viewBox="0 0 240 140" style={{ width: "100%", height: "100%" }} aria-hidden>
          {/* Background arc */}
          <path d={bgPath} fill="none" stroke="var(--border-soft)" strokeWidth={14} strokeLinecap="round" />
          {/* Score arc */}
          <path
            d={arcPath}
            fill="none"
            stroke={tone.color}
            strokeWidth={14}
            strokeLinecap="round"
            style={{ transition: "stroke 0.4s, d 0.4s" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 24,
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              color: "var(--text-1)",
              letterSpacing: "-0.03em",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {safe}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            de 100
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--text-2)",
          textAlign: "center",
          fontWeight: 500,
        }}
      >
        <span style={{ color: tone.color, fontSize: 16 }} aria-hidden>{tone.emoji}</span>
        <span>{motivationalMessage(safe, delta)}</span>
      </div>
    </div>
  );
}

function scoreTone(score: number) {
  if (score >= 85) return { color: "#10b981", emoji: "🎯" };
  if (score >= 70) return { color: "#84cc16", emoji: "💪" };
  if (score >= 50) return { color: "#d97706", emoji: "⚡" };
  return { color: "#dc2626", emoji: "🔴" };
}

function motivationalMessage(score: number, delta: number | null): string {
  if (delta != null && delta >= 5) {
    return `+${delta} pts arriba del promedio mensual`;
  }
  if (delta != null && delta <= -5) {
    return `${delta} pts abajo del promedio mensual`;
  }
  if (score >= 85) return "Excelente uso de tu agenda";
  if (score >= 70) return "Buen ritmo, hay espacio para optimizar";
  if (score >= 50) return "Hay oportunidades de mejora";
  return "Capacidad sub-utilizada — revisa la ocupación";
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end   = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

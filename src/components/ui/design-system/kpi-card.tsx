// Server-safe: no hooks ni event handlers → no "use client".
// Pasar un LucideIcon como prop desde un Server Component fallaba con el error
// "Functions cannot be passed directly to Client Components" cuando este
// archivo estaba marcado como "use client".

import type { CSSProperties } from "react";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";

export type KpiAccent = "brand" | "info" | "success" | "warning" | "danger";

type KpiCardProps = {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; sub?: string };
  icon?: LucideIcon;
  /** KPI primario del grupo: chip del icono con degradado de marca (solo UNO por fila). */
  hero?: boolean;
  /**
   * Tiñe SOLO el número, para señalar un consumo alto (cupo del plan al 80%/100%).
   * Sin tone el valor conserva var(--text-1); son tokens, así que funciona en
   * light y en dark sin tocar globals.css.
   */
  tone?: "warning" | "danger";
  /**
   * Aclaración corta bajo el número, para KPIs que se malinterpretan solos
   * (ej. "Ingresos" de una clínica = lo que ella cobra a SUS pacientes).
   * Va con estilo inline a propósito: no toca globals.css.
   */
  hint?: string;
  /**
   * Color de acento del KPI (chip del icono + sparkline). OPT-IN: sin esta
   * prop la tarjeta se ve exactamente igual que siempre, así que las ~290
   * tarjetas del resto del panel no cambian. En el hero manda el degradado de
   * marca del chip; el acento sólo tiñe el sparkline.
   */
  accent?: KpiAccent;
  /**
   * Serie corta para el sparkline a pie de tarjeta (ej. 6 meses de ingresos).
   * Es decoración de contexto: sin ejes ni tooltip. Se omite con menos de 2
   * puntos o si todos valen 0 (una línea plana no informa, sólo ensucia).
   */
  sparkline?: number[];
  /** Texto accesible del sparkline (lo lee el lector de pantalla). */
  sparklineLabel?: string;
};

const TONE_COLOR: Record<"warning" | "danger", string> = {
  warning: "var(--warning)",
  danger: "var(--danger)",
};

const ACCENT_VARS: Record<KpiAccent, { color: string; soft: string }> = {
  brand:   { color: "var(--brand)",   soft: "var(--brand-soft)" },
  info:    { color: "var(--info)",    soft: "var(--info-soft)" },
  success: { color: "var(--success)", soft: "var(--success-soft)" },
  warning: { color: "var(--warning)", soft: "var(--warning-soft)" },
  danger:  { color: "var(--danger)",  soft: "var(--danger-soft)" },
};

export function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  hero,
  tone,
  hint,
  accent,
  sparkline,
  sparklineLabel,
}: KpiCardProps) {
  const cls = ["kpi", hero ? "kpi--hero" : "", accent ? "kpi--accent" : ""]
    .filter(Boolean)
    .join(" ");
  const accentStyle = accent
    ? ({
        "--kpi-accent": ACCENT_VARS[accent].color,
        "--kpi-accent-soft": ACCENT_VARS[accent].soft,
      } as CSSProperties)
    : undefined;

  return (
    <div className={cls} style={accentStyle}>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {Icon && (
          <div className="kpi__icon">
            <Icon size={17} strokeWidth={1.75} />
          </div>
        )}
      </div>
      <div className="kpi__value" style={tone ? { color: TONE_COLOR[tone] } : undefined}>{value}</div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6, lineHeight: 1.3 }}>
          {hint}
        </div>
      )}
      {delta && (
        <div className={`kpi__delta kpi__delta--${delta.direction}`}>
          <span className="kpi__delta-pill">
            {delta.direction === "up"
              ? <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
              : <ArrowDownRight size={14} strokeWidth={2} aria-hidden />}
            {delta.value}
          </span>
          {delta.sub && <span className="kpi__delta-sub">{delta.sub}</span>}
        </div>
      )}
      <KpiSparkline values={sparkline} label={sparklineLabel} />
    </div>
  );
}

/**
 * Sparkline en SVG inline: sin recharts, sin JS y sin costo de bundle. Se
 * estira al ancho de la tarjeta con preserveAspectRatio="none" (el trazo se
 * compensa con vector-effect para que no engorde al escalar).
 */
function KpiSparkline({ values, label }: { values?: number[]; label?: string }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= 0) return null;

  const W = 100;
  const H = 26;
  // Margen de 1.5 u a cada lado: con preserveAspectRatio="none" el trazo se
  // dibuja centrado en el punto y sin este colchón el primero y el último
  // quedan cortados por el overflow:hidden de la tarjeta.
  const PADX = 1.5;
  const base = min < 0 ? min : 0;
  const scale = max - base || 1;
  const step = (W - PADX * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = PADX + i * step;
    const y = H - 1.5 - ((v - base) / scale) * (H - 3);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)},${H} L${PADX},${H} Z`;

  return (
    <div className="kpi__spark" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {/* Sin punto final: preserveAspectRatio="none" estira el eje X y un
          <circle> saldría deformado en óvalo. */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
        <path d={area} fill="var(--kpi-accent-soft, var(--brand-soft))" stroke="none" />
        <path
          d={line}
          fill="none"
          stroke="var(--kpi-accent, var(--brand))"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

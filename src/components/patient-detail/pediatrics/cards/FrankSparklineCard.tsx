// Pediatrics — Mini sparkline de Frankl (últimas 5 visitas). Spec: §1.7, §4.A.8

import type { BehaviorAssessmentRow } from "@/types/pediatrics";

export interface FrankSparklineCardProps {
  history: BehaviorAssessmentRow[];
}

export function FrankSparklineCard(props: FrankSparklineCardProps) {
  const recent = props.history
    .filter((h) => h.scale === "frankl" && !h.deletedAt)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .slice(-5);

  if (recent.length === 0) {
    return (
      <div className="pedi-card">
        <h3 className="pedi-card__title">Conducta (Frankl)</h3>
        <p className="pedi-card__empty">Sin capturas todavía.</p>
      </div>
    );
  }

  const W = 240;
  const H = 60;
  const PAD = 8;
  const points = recent.map((h, i) => {
    const x = recent.length === 1 ? W / 2 : PAD + (i / (recent.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((h.value - 1) / 3) * (H - PAD * 2);
    return { x, y, value: h.value };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = recent[recent.length - 1]!;

  return (
    <div className="pedi-card pedi-frank-sparkline-card">
      <h3 className="pedi-card__title">Conducta (Frankl) · últimas {recent.length}</h3>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="Tendencia Frankl">
        <path d={path} stroke="var(--brand)" strokeWidth={2} fill="none" />
        {points.map((p) => (
          <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r={3} fill={dotColor(p.value)} />
        ))}
      </svg>
      <div className="pedi-frank-sparkline-card__last">
        Última: <span className={`frankl-pill frankl-pill--${last.value}`}>{last.value}</span>
      </div>
    </div>
  );
}

function dotColor(v: number): string {
  if (v === 1) return "var(--danger)";
  if (v === 2) return "var(--warning)";
  if (v === 3) return "var(--info)";
  return "var(--success)";
}

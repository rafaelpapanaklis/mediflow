// Atom: barra de avance (6 px, como la del estado de cuenta de la ficha).

import orto from "../orto.module.css";

type Color = "violet" | "emerald" | "amber" | "rose";

const COLORS: Record<Color, string> = {
  violet: "",
  emerald: orto.barraExito,
  amber: orto.barraAlerta,
  rose: orto.barraPeligro,
};

export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: Color;
  className?: string;
  ariaLabel?: string;
}

export function ProgressBar({
  value,
  max = 100,
  color = "violet",
  className = "",
  ariaLabel,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={[orto.barra, className].filter(Boolean).join(" ")}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={[orto.barraRelleno, COLORS[color]].filter(Boolean).join(" ")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

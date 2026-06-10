import { Star } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Estrellas de calificación (solo display). Rellena con precisión por estrella
// (medias por clip). Sin "use client": funciona en server y client. Ámbar
// (#f59e0b) sobre gris (#e2e8f0). Usado en cards, perfil y paneles.
// ─────────────────────────────────────────────────────────────────────────────

const FILLED = "#f59e0b";
const EMPTY = "#e2e8f0";

function OneStar({ size, fill }: { size: number; fill: number }) {
  const clamped = Math.max(0, Math.min(1, fill));
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, lineHeight: 0 }}>
      <Star size={size} fill={EMPTY} strokeWidth={0} style={{ position: "absolute", inset: 0, color: EMPTY }} />
      {clamped > 0 && (
        <span style={{ position: "absolute", inset: 0, overflow: "hidden", width: `${clamped * 100}%` }}>
          <Star size={size} fill={FILLED} strokeWidth={0} style={{ color: FILLED }} />
        </span>
      )}
    </span>
  );
}

export function ReviewStars({
  value,
  size = 16,
  gap = 2,
  className,
}: {
  value: number;
  size?: number;
  gap?: number;
  className?: string;
}) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap }}
      role="img"
      aria-label={`${v.toFixed(1)} de 5 estrellas`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <OneStar key={i} size={size} fill={v - i} />
      ))}
    </span>
  );
}

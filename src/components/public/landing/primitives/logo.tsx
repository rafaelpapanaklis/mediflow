import type { CSSProperties } from "react";

interface LogoProps {
  size?: number;
  color?: string;
  showText?: boolean;
  style?: CSSProperties;
}

export function Logo({ size = 20, color = "var(--ld-brand-light, #a78bfa)", showText = true, style }: LogoProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 12 L8 12 L10 6 L14 18 L16 12 L20 12"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && (
        <span
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            fontSize: size * 0.85,
            color: "var(--ld-fg, #f5f5f7)",
          }}
        >
          MediFlow
        </span>
      )}
    </span>
  );
}

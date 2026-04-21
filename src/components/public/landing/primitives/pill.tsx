import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 12px",
        borderRadius: 100,
        background: "rgba(124,58,237,0.12)",
        border: "1px solid rgba(124,58,237,0.25)",
        color: "var(--ld-brand-light, #a78bfa)",
        fontSize: 11,
        fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

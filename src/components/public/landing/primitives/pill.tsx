import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 12px",
        borderRadius: 100,
        background: "var(--ld-brand-weak, rgba(124,58,237,0.12))",
        border: "1px solid var(--ld-brand-weak-border, rgba(124,58,237,0.25))",
        color: "var(--ld-brand-strong, #a78bfa)",
        fontSize: 11,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

import type { CSSProperties, ReactNode } from "react";

interface FloatCardProps {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function FloatCard({ title, children, style }: FloatCardProps) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: 16,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow:
          "0 30px 60px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.08), 0 0 40px rgba(124,58,237,0.1)",
        backdropFilter: "blur(20px)",
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            fontSize: 10,
            color: "rgba(245,245,247,0.4)",
            letterSpacing: "0.08em",
            textTransform: "lowercase",
            marginBottom: 8,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

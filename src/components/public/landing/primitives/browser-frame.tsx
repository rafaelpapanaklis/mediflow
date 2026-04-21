import type { CSSProperties, ReactNode } from "react";

interface BrowserFrameProps {
  children: ReactNode;
  url?: string;
  style?: CSSProperties;
}

export function BrowserFrame({ children, url = "app.mediflow.mx", style }: BrowserFrameProps) {
  return (
    <div
      style={{
        borderRadius: 14,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow:
          "0 40px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.1), 0 0 80px rgba(124,58,237,0.15)",
        overflow: "hidden",
        backdropFilter: "blur(20px)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 10, background: "#ff5f57" }} />
          <span style={{ width: 10, height: 10, borderRadius: 10, background: "#febc2e" }} />
          <span style={{ width: 10, height: 10, borderRadius: 10, background: "#28c840" }} />
        </div>
        <div
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            fontSize: 11,
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            color: "rgba(255,255,255,0.4)",
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
          }}
        >
          {url}
        </div>
        <div style={{ width: 50 }} />
      </div>
      {children}
    </div>
  );
}

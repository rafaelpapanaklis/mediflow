// src/components/dashboard/home/home-section.tsx
import type { ReactNode } from "react";

export interface HomeSectionProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  noPad?: boolean;
  className?: string;
}

export function HomeSection({
  title,
  subtitle,
  action,
  children,
  noPad,
  className,
}: HomeSectionProps) {
  return (
    <section
      className={className}
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-1)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 20px 12px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-1)",
              margin: 0,
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--text-3)",
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </header>
      <div style={{ padding: noPad ? 0 : "0 20px 20px" }}>{children}</div>
    </section>
  );
}

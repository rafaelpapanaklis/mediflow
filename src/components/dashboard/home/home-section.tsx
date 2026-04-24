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
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(15,10,30,0.04), 0 1px 2px rgba(15,10,30,0.03)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-soft)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </header>
      <div style={{ padding: noPad ? 0 : 18 }}>{children}</div>
    </section>
  );
}

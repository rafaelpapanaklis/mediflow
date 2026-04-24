// src/components/dashboard/home/parts/task-row.tsx
"use client";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

interface TaskRowProps {
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
  ctaLabel: string;
  tone?: "brand" | "warning" | "info";
}

export function TaskRow({
  icon: Icon,
  label,
  count,
  href,
  ctaLabel,
  tone = "brand",
}: TaskRowProps) {
  if (count <= 0) return null;

  const toneColor: Record<NonNullable<TaskRowProps["tone"]>, string> = {
    brand:   "var(--trial-accent-calm)",
    warning: "var(--trial-accent-warning)",
    info:    "var(--info)",
  };

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid var(--border-soft)",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--brand-softer)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          border: "1px solid rgba(124,58,237,0.15)",
        }}
      >
        <Icon size={14} style={{ color: toneColor[tone] }} aria-hidden />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
          <span
            style={{
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              fontWeight: 600,
              color: toneColor[tone],
              marginRight: 4,
            }}
          >
            {count}
          </span>
          {label}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--brand)",
            marginTop: 2,
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          {ctaLabel}
          <ChevronRight size={11} aria-hidden />
        </div>
      </div>
    </Link>
  );
}

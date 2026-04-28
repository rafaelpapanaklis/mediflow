// src/components/dashboard/home/parts/action-item-row.tsx
"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { HomeActionItem } from "@/lib/home/types";

const TONE_DOT: Record<HomeActionItem["tone"], string> = {
  brand:   "var(--brand)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger:  "var(--danger)",
  info:    "var(--info)",
  neutral: "var(--text-3)",
};

const TONE_GLOW: Record<HomeActionItem["tone"], string> = {
  brand:   "0 0 6px rgba(124,58,237,0.55)",
  success: "0 0 6px rgba(5,150,105,0.55)",
  warning: "0 0 6px rgba(217,119,6,0.55)",
  danger:  "0 0 6px rgba(220,38,38,0.55)",
  info:    "0 0 6px rgba(37,99,235,0.55)",
  neutral: "none",
};

export function ActionItemRow({ item }: { item: HomeActionItem }) {
  const cta = item.cta;

  const body = (
    <>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: TONE_DOT[item.tone],
          boxShadow: TONE_GLOW[item.tone],
          flexShrink: 0,
          marginTop: 6,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            lineHeight: 1.35,
          }}
        >
          {item.title}
        </div>
        {item.detail && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              marginTop: 2,
              lineHeight: 1.45,
            }}
          >
            {item.detail}
          </div>
        )}
        {cta && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "var(--brand)",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            {cta.label}
            <ChevronRight size={12} aria-hidden />
          </div>
        )}
      </div>
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-soft)",
    textDecoration: "none",
    color: "inherit",
    cursor: cta ? "pointer" : "default",
    transition: "background 0.12s",
  };

  if (cta?.href) {
    return (
      <Link
        href={cta.href}
        style={baseStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {body}
      </Link>
    );
  }
  if (cta?.onClick) {
    return (
      <button
        type="button"
        onClick={cta.onClick}
        style={{
          ...baseStyle,
          textAlign: "left",
          background: "transparent",
          border: "none",
          width: "100%",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {body}
      </button>
    );
  }
  return <div style={baseStyle}>{body}</div>;
}

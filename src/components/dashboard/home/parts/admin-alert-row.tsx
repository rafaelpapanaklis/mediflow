// src/components/dashboard/home/parts/admin-alert-row.tsx
"use client";
import Link from "next/link";
import { AlertTriangle, AlertCircle, Info, ChevronRight } from "lucide-react";
import type { HomeAdminAlert } from "@/lib/home/types";

const TONE_ICON: Record<HomeAdminAlert["tone"], React.ElementType> = {
  warning: AlertTriangle,
  danger:  AlertCircle,
  info:    Info,
};

const TONE_COLOR: Record<HomeAdminAlert["tone"], string> = {
  warning: "var(--warning)",
  danger:  "var(--danger)",
  info:    "var(--info)",
};

const TONE_BG: Record<HomeAdminAlert["tone"], string> = {
  warning: "var(--warning-soft)",
  danger:  "var(--danger-soft)",
  info:    "var(--info-soft)",
};

export function AdminAlertRow({ alert }: { alert: HomeAdminAlert }) {
  const Icon = TONE_ICON[alert.tone];

  const body = (
    <>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: TONE_BG[alert.tone],
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={14} style={{ color: TONE_COLOR[alert.tone] }} aria-hidden />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            lineHeight: 1.35,
          }}
        >
          {alert.title}
        </div>
        {alert.detail && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              marginTop: 2,
              lineHeight: 1.45,
            }}
          >
            {alert.detail}
          </div>
        )}
      </div>
      {alert.href && (
        <ChevronRight
          size={14}
          style={{ color: "var(--text-3)", flexShrink: 0 }}
          aria-hidden
        />
      )}
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-soft)",
    textDecoration: "none",
    color: "inherit",
    transition: "background 0.12s",
  };

  if (alert.href) {
    return (
      <Link
        href={alert.href}
        style={baseStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {body}
      </Link>
    );
  }
  return <div style={baseStyle}>{body}</div>;
}

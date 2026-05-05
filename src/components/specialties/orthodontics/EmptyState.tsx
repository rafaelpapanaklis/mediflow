"use client";
// Orthodontics — empty state genérico. SPEC §11.6.

import { Smile } from "lucide-react";

export function EmptyState(props: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--bg-elev)",
        border: "1px dashed var(--border)",
        borderRadius: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--brand-soft, rgba(99,102,241,0.18))",
          color: "var(--brand, #6366f1)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.icon ?? <Smile size={22} aria-hidden />}
      </span>
      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
          {props.title}
        </h3>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-2)", maxWidth: 460 }}>
          {props.description}
        </p>
      </div>
      {props.cta ? (
        <button
          type="button"
          onClick={props.cta.onClick}
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            border: "1px solid var(--brand, #6366f1)",
            background: "var(--brand, #6366f1)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {props.cta.label}
        </button>
      ) : null}
    </div>
  );
}

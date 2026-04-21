"use client";

import { useState } from "react";

export type PlanId = "BASIC" | "PRO" | "CLINIC";
export type Billing = "monthly" | "annual";

interface PlanCardProps {
  plan: PlanId;
  name: string;
  description: string;
  priceMonthly: number;
  priceAnnual: number;
  billing: Billing;
  features: string[];
  popular?: boolean;
  mostComplete?: boolean;
  selected: boolean;
  onSelect: () => void;
}

export function PlanCard({
  name,
  description,
  priceMonthly,
  priceAnnual,
  billing,
  features,
  popular,
  mostComplete,
  selected,
  onSelect,
}: PlanCardProps) {
  const [hover, setHover] = useState(false);
  const price = billing === "annual" ? priceAnnual : priceMonthly;

  const borderColor = selected
    ? "rgba(124,58,237,0.6)"
    : popular
      ? "rgba(124,58,237,0.3)"
      : "var(--ld-border)";

  const background = selected
    ? "linear-gradient(180deg, rgba(124,58,237,0.14), rgba(124,58,237,0.04))"
    : popular
      ? "linear-gradient(180deg, rgba(124,58,237,0.06), rgba(255,255,255,0.01))"
      : "rgba(255,255,255,0.02)";

  const boxShadow = selected
    ? "0 0 30px rgba(124,58,237,0.2), 0 0 0 3px rgba(124,58,237,0.1)"
    : popular
      ? "0 0 40px rgba(124,58,237,0.12)"
      : hover
        ? "0 10px 30px rgba(0,0,0,0.25)"
        : "none";

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        padding: 22,
        borderRadius: 16,
        textAlign: "left",
        background,
        border: `1px solid ${borderColor}`,
        boxShadow,
        transform: hover && !selected ? "translateY(-2px)" : "none",
        transition: "all 0.2s",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        color: "var(--ld-fg)",
        fontFamily: "inherit",
        width: "100%",
      }}
    >
      {popular && (
        <div
          style={{
            position: "absolute",
            top: -10,
            left: 18,
            padding: "3px 10px",
            borderRadius: 100,
            background: "linear-gradient(90deg, #a78bfa, #7c3aed)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          }}
        >
          Más popular
        </div>
      )}
      {mostComplete && (
        <div
          style={{
            position: "absolute",
            top: -10,
            right: 18,
            padding: "3px 10px",
            borderRadius: 100,
            background: "rgba(52,211,153,0.15)",
            color: "#34d399",
            border: "1px solid rgba(52,211,153,0.35)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          }}
        >
          Más completa
        </div>
      )}

      {selected && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 22,
            height: 22,
            borderRadius: 22,
            background: "#34d399",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 4px 12px rgba(52,211,153,0.4)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6 L5 9 L10 3"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 18,
            flexShrink: 0,
            border: `2px solid ${selected ? "var(--ld-brand-light)" : "rgba(255,255,255,0.2)"}`,
            background: selected
              ? "radial-gradient(circle, var(--ld-brand-light) 45%, transparent 50%)"
              : "transparent",
          }}
        />
        <div
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: "0.08em",
            color: selected || popular ? "#a78bfa" : "var(--ld-fg)",
          }}
        >
          {name}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "-0.04em",
            color: "var(--ld-fg)",
          }}
        >
          ${price}
        </span>
        <span style={{ fontSize: 13, color: "var(--ld-fg-muted)" }}>USD/mes</span>
        {billing === "annual" && priceAnnual < priceMonthly && (
          <span
            style={{
              textDecoration: "line-through",
              color: "var(--ld-fg-muted)",
              fontSize: 12,
              fontFamily:
                "var(--font-jetbrains-mono, ui-monospace, monospace)",
              marginLeft: 2,
            }}
          >
            ${priceMonthly}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ld-fg-muted)", marginTop: -6 }}>
        {description}
      </div>

      <div style={{ height: 1, background: "var(--ld-border)" }} />

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {features.map((f, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: 9,
              fontSize: 12.5,
              color: "var(--ld-fg-muted)",
              lineHeight: 1.4,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: selected ? "#34d399" : popular ? "#a78bfa" : "var(--ld-fg-muted)",
                flexShrink: 0,
                fontSize: 12,
                marginTop: 1,
              }}
            >
              ✓
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

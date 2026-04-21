"use client";

import type { ReactNode } from "react";

interface PaymentMethodCardProps {
  method: "card" | "paypal";
  selected: boolean;
  onSelect: () => void;
  children?: ReactNode;
}

export function PaymentMethodCard({
  method,
  selected,
  onSelect,
  children,
}: PaymentMethodCardProps) {
  const title =
    method === "card" ? "Tarjeta de débito o crédito" : "PayPal";
  const subtitle =
    method === "card"
      ? "Visa, Mastercard, American Express · Paga en MXN o USD"
      : "Vincula tu cuenta PayPal · redirección segura";

  return (
    <div
      style={{
        borderRadius: 12,
        background: selected
          ? "rgba(124,58,237,0.06)"
          : "rgba(255,255,255,0.02)",
        border: `1px solid ${selected ? "rgba(124,58,237,0.5)" : "var(--ld-border)"}`,
        overflow: "hidden",
        transition: "all 0.2s",
        boxShadow: selected ? "0 0 0 3px rgba(124,58,237,0.1)" : "none",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 14,
          color: "var(--ld-fg)",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ld-fg)" }}>
            {title}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ld-fg-muted)",
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        </div>
        {method === "card" ? <CardBrandsRow /> : <PayPalMark />}
      </button>

      <div
        style={{
          maxHeight: selected ? 1000 : 0,
          overflow: "hidden",
          transition: "max-height 0.25s ease",
        }}
      >
        <div
          style={{
            padding: "4px 16px 18px",
            borderTop: selected ? "1px solid var(--ld-border)" : "none",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function CardBrandsRow() {
  return (
    <div style={{ display: "flex", gap: 4, pointerEvents: "none" }}>
      <BrandChip label="VISA" bg="#1a1f71" />
      <BrandChip label="MC" bg="#eb001b" />
      <BrandChip label="AMEX" bg="#006fcf" />
    </div>
  );
}

function BrandChip({ label, bg }: { label: string; bg: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 22,
        borderRadius: 4,
        background: bg,
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.05em",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
      }}
    >
      {label}
    </div>
  );
}

function PayPalMark() {
  return (
    <div
      style={{
        padding: "3px 9px",
        borderRadius: 4,
        background: "linear-gradient(180deg, #0070ba, #003087)",
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        letterSpacing: "-0.02em",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span style={{ fontStyle: "italic" }}>Pay</span>
      <span style={{ color: "#009cde", fontStyle: "italic" }}>Pal</span>
    </div>
  );
}

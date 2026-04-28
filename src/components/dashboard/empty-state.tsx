"use client";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyStateTone =
  | "brand" | "success" | "warning" | "danger" | "neutral";

export type EmptyStateSize = "sm" | "md" | "lg";

export interface EmptyStateCta {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
}

export interface EmptyStateNewProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  primaryCta?: EmptyStateCta;
  secondaryCta?: EmptyStateCta;
  tone?: EmptyStateTone;
  size?: EmptyStateSize;
  className?: string;
}

interface ToneStyle {
  iconBg: string;
  iconBorder: string;
  iconColor: string;
}

function resolveTone(tone: EmptyStateTone): ToneStyle {
  switch (tone) {
    case "brand":
      return {
        iconBg: "var(--brand-softer)",
        iconBorder: "rgba(124,58,237,0.20)",
        iconColor: "var(--brand)",
      };
    case "success":
      return {
        iconBg: "var(--success-soft)",
        iconBorder: "rgba(5,150,105,0.25)",
        iconColor: "var(--success)",
      };
    case "warning":
      return {
        iconBg: "var(--warning-soft)",
        iconBorder: "rgba(217,119,6,0.25)",
        iconColor: "var(--warning)",
      };
    case "danger":
      return {
        iconBg: "var(--danger-soft)",
        iconBorder: "rgba(220,38,38,0.25)",
        iconColor: "var(--danger)",
      };
    case "neutral":
    default:
      return {
        iconBg: "var(--bg-elev-2)",
        iconBorder: "var(--border-soft)",
        iconColor: "var(--text-2)",
      };
  }
}

interface SizeSpec {
  iconBox: number;
  iconPad: number;
  iconSize: number;
  iconRadius: number;
  titleSize: string;
  descSize: number;
  gapVertical: number;
  paddingBlock: string;
  maxDescWidth: number;
  ctaSize: "sm" | "md";
}

function resolveSize(size: EmptyStateSize): SizeSpec {
  switch (size) {
    case "sm":
      return {
        iconBox: 44, iconPad: 10, iconSize: 20, iconRadius: 12,
        titleSize: "14px", descSize: 12, gapVertical: 10,
        paddingBlock: "clamp(20px, 4vh, 40px)",
        maxDescWidth: 280, ctaSize: "sm",
      };
    case "lg":
      return {
        iconBox: 72, iconPad: 18, iconSize: 32, iconRadius: 20,
        titleSize: "18px", descSize: 14, gapVertical: 16,
        paddingBlock: "clamp(48px, 8vh, 96px)",
        maxDescWidth: 420, ctaSize: "md",
      };
    case "md":
    default:
      return {
        iconBox: 56, iconPad: 14, iconSize: 24, iconRadius: 16,
        titleSize: "clamp(15px, 1vw, 17px)", descSize: 13, gapVertical: 14,
        paddingBlock: "clamp(32px, 6vh, 80px)",
        maxDescWidth: 360, ctaSize: "md",
      };
  }
}

export function EmptyStateNew({
  icon: Icon, title, description, primaryCta, secondaryCta,
  tone = "brand", size = "md", className,
}: EmptyStateNewProps) {
  const t = resolveTone(tone);
  const sz = resolveSize(size);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mf-empty ${className ?? ""}`}
      style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        textAlign: "center",
        paddingBlock: sz.paddingBlock,
        paddingInline: "clamp(16px, 3vw, 32px)",
        width: "100%",
        gap: sz.gapVertical,
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      <div
        style={{
          width: sz.iconBox, height: sz.iconBox,
          borderRadius: sz.iconRadius,
          background: t.iconBg,
          border: `1px solid ${t.iconBorder}`,
          display: "grid", placeItems: "center",
          flexShrink: 0,
          boxShadow: tone === "brand" ? "0 0 24px rgba(124,58,237,0.08)" : "none",
        }}
      >
        <Icon size={sz.iconSize} style={{ color: t.iconColor }} aria-hidden />
      </div>

      <h3
        style={{
          fontSize: sz.titleSize, fontWeight: 600,
          color: "var(--text-1)",
          margin: 0, lineHeight: 1.3,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>

      {description && (
        <p
          style={{
            fontSize: sz.descSize,
            color: "var(--text-2)",
            lineHeight: 1.55,
            maxWidth: sz.maxDescWidth,
            margin: 0,
          }}
        >
          {description}
        </p>
      )}

      {(primaryCta || secondaryCta) && (
        <div
          style={{
            display: "flex", flexWrap: "wrap", gap: 8,
            justifyContent: "center",
            marginTop: size === "sm" ? 2 : 4,
          }}
        >
          {primaryCta && (
            <EmptyCtaButton cta={primaryCta} variant="primary" size={sz.ctaSize} />
          )}
          {secondaryCta && (
            <EmptyCtaButton cta={secondaryCta} variant="secondary" size={sz.ctaSize} />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyCtaButton({
  cta, variant, size,
}: {
  cta: EmptyStateCta;
  variant: "primary" | "secondary";
  size: "sm" | "md";
}) {
  const IconLeft = cta.icon;
  const isSmall = size === "sm";
  const isPrimary = variant === "primary";

  const inner = (
    <>
      {IconLeft && <IconLeft size={isSmall ? 12 : 14} aria-hidden />}
      {cta.label}
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center",
    gap: 6, height: isSmall ? 28 : 32,
    padding: isSmall ? "0 10px" : "0 12px",
    borderRadius: 8, fontSize: isSmall ? 11 : 12,
    fontWeight: 500, cursor: "pointer",
    border: "1px solid transparent", whiteSpace: "nowrap",
    fontFamily: "inherit", textDecoration: "none",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  };

  const primaryStyle: React.CSSProperties = {
    ...baseStyle,
    background: "var(--brand)",
    color: "#fff",
    boxShadow:
      "0 0 0 1px rgba(124,58,237,0.5), 0 4px 16px -4px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
  };

  const secondaryStyle: React.CSSProperties = {
    ...baseStyle,
    background: "var(--bg-elev)",
    color: "var(--text-1)",
    borderColor: "var(--border-strong)",
  };

  const style = isPrimary ? primaryStyle : secondaryStyle;

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (isPrimary) {
      e.currentTarget.style.background = "#8b5cf6";
    } else {
      e.currentTarget.style.background = "var(--bg-elev-2)";
      e.currentTarget.style.borderColor = "var(--border-brand)";
    }
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (isPrimary) {
      e.currentTarget.style.background = "var(--brand)";
    } else {
      e.currentTarget.style.background = "var(--bg-elev)";
      e.currentTarget.style.borderColor = "var(--border-strong)";
    }
  };

  if (cta.href) {
    return (
      <Link href={cta.href} style={style}
        onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={cta.onClick} style={style}
      onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {inner}
    </button>
  );
}

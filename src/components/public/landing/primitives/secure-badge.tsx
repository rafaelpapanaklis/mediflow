import type { CSSProperties } from "react";

/**
 * Sello de confianza "Datos cifrados" para superficies públicas.
 *
 * Tres tonos porque son tres fondos distintos:
 *  · dark  → SalesFooter (#080d1a), hex fijos.
 *  · token → Footer viejo, que vive bajo .landing-theme: usa los --ld-* para
 *            seguir el tema si algún día esas páginas dejan de ser oscuras.
 *  · light → tarjeta blanca del login.
 *
 * El copy es el mismo que el hero y el FAQ ("Datos cifrados"): TLS en tránsito
 * y AES-256 en reposo. Nada de "100% seguro" ni "extremo a extremo".
 */
type Tone = "dark" | "light" | "token";

const TONES: Record<Tone, {
  bg: string; border: string; icon: string; check: string;
  text: string; sub: string; sep: string;
}> = {
  dark: {
    bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.14)",
    icon: "#a78bfa", check: "#080d1a",
    text: "#e2e8f0", sub: "#94a3b8", sep: "rgba(255,255,255,0.16)",
  },
  token: {
    bg: "rgba(148,163,184,0.08)", border: "var(--ld-border, rgba(148,163,184,0.25))",
    icon: "var(--ld-brand-light, #a78bfa)", check: "var(--ld-bg, #080d1a)",
    text: "var(--ld-fg, #e2e8f0)", sub: "var(--ld-fg-muted, #94a3b8)",
    sep: "var(--ld-border, rgba(148,163,184,0.25))",
  },
  light: {
    bg: "#f8fafc", border: "#e2e8f0",
    icon: "#7c3aed", check: "#ffffff",
    text: "#0f172a", sub: "#64748b", sep: "#e2e8f0",
  },
};

export function SecureBadge({
  tone = "dark",
  style,
}: {
  tone?: Tone;
  style?: CSSProperties;
}) {
  const c = TONES[tone];
  return (
    <span
      className="dc-secure"
      title="Cifrado TLS en tránsito y AES-256 en reposo"
      aria-label="Datos cifrados: TLS en tránsito y AES-256 en reposo"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 14px",
        borderRadius: 999,
        background: c.bg,
        border: `1px solid ${c.border}`,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" stroke={c.icon} strokeWidth="2" strokeLinecap="round" />
        <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" fill={c.icon} />
        <path d="M9.3 15.9l1.9 1.9 3.5-3.7" stroke={c.check} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: 13, color: c.text }}>Datos cifrados</span>
      <span className="dc-secure__sep" aria-hidden="true" style={{ width: 1, height: 13, background: c.sep }} />
      <span className="dc-secure__meta" style={{ fontSize: 12, color: c.sub, letterSpacing: "0.02em" }}>
        TLS + AES-256
      </span>
      <style>{`
        /* Bajo ~380px la pastilla completa ya no cabe en el ancho de pantalla:
           se cae el detalle técnico y queda solo "Datos cifrados". Aquí @media
           es correcto (no hay sidebar que cambie el ancho real del contenedor:
           footer a todo lo ancho y tarjeta de login que a ese tamaño ocupa
           prácticamente el viewport). */
        @media (max-width: 380px) {
          .dc-secure__sep, .dc-secure__meta { display: none; }
        }
      `}</style>
    </span>
  );
}

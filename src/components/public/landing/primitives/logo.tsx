import { useId, type CSSProperties } from "react";

/**
 * Marca DaleControl (kit "logo 105"): capas apiladas = toda la operación de la
 * clínica en un solo lugar. Cima lila con borde morado; dos niveles en
 * degradado morado→azul (#7C3AED→#2563EB), el segundo al 45%.
 * Maestros vectoriales en /public/brand/ (icon-color/blanco/negro.svg).
 */

/** Colores de marca (README del kit). */
export const BRAND = {
  morado: "#7C3AED",
  azul: "#2563EB",
  tinta: "#17151F",
  lila: "#EFEAFE",
} as const;

interface BrandGlyphProps {
  size?: number;
  /** Una sola tinta (p. ej. "#fff" sobre fondos oscuros). Sin `mono` → versión a color con degradado. */
  mono?: string;
  style?: CSSProperties;
}

/** Icono solo (capas apiladas), fiel a svg/icon-color.svg / icon-blanco.svg del kit. */
export function BrandGlyph({ size = 20, mono, style }: BrandGlyphProps) {
  const gid = useId();
  const stroke = mono ?? `url(#${gid})`;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" style={style}>
      {!mono && (
        <defs>
          <linearGradient id={gid} x1="0" x2="1">
            <stop offset="0" stopColor={BRAND.morado} />
            <stop offset="1" stopColor={BRAND.azul} />
          </linearGradient>
        </defs>
      )}
      <path
        d="M18 4 L31 11 L18 18 L5 11 Z"
        fill={mono ? "rgba(255,255,255,.18)" : BRAND.lila}
        stroke={mono ?? BRAND.morado}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M5.5 18.5 L18 25.2 L30.5 18.5" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 24.5 L18 31.2 L30.5 24.5" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".45" />
    </svg>
  );
}

interface LogoProps {
  size?: number;
  color?: string;
  showText?: boolean;
  style?: CSSProperties;
}

/**
 * Lockup icono + wordmark. Conserva el contrato histórico: `color` tiñe el
 * icono en una sola tinta (estas superficies son fondos oscuros/tema propio)
 * y el texto usa el foreground del contexto.
 */
export function Logo({ size = 20, color = "var(--ld-brand-light, #a78bfa)", showText = true, style }: LogoProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      <BrandGlyph size={size} mono={color} />
      {showText && (
        <span
          style={{
            fontFamily: "var(--font-logo, var(--font-sans, system-ui, sans-serif))",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            fontSize: size * 0.85,
            color: "var(--ld-fg, #f5f5f7)",
          }}
        >
          <span style={{ fontWeight: 700 }}>Dale</span>Control
        </span>
      )}
    </span>
  );
}

import Link from "next/link";
import type { Specialty } from "@/lib/specialty-data";
import { BrowserFrame } from "../primitives/browser-frame";
import { Glow } from "../primitives/glow";
import { GridBg } from "../primitives/grid-bg";
import { getSpecialtyMockup } from "../mockups/specialty";

function accentToRgb(hex: string): string {
  return hex === "#34d399"
    ? "52,211,153"
    : hex === "#38bdf8"
    ? "56,189,248"
    : hex === "#fbbf24"
    ? "251,191,36"
    : "167,139,250";
}

function Breadcrumb({ spec, accent }: { spec: Specialty; accent: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 100,
        background: accent + "18",
        border: `1px solid ${accent}33`,
        fontSize: 12,
        color: accent,
        fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
      }}
    >
      <span style={{ opacity: 0.7 }}>Especialidades</span>
      <span style={{ opacity: 0.4 }}>/</span>
      <span>{spec.category}</span>
      <span style={{ opacity: 0.4 }}>/</span>
      <span style={{ fontWeight: 600 }}>{spec.name}</span>
    </div>
  );
}

export function SpecHero({ spec }: { spec: Specialty }) {
  const accent = spec.accent;
  const accentRgb = accentToRgb(accent);
  const Mock = getSpecialtyMockup(spec.mockupKey);
  const urlSlug = spec.name.toLowerCase().replace(/\s+/g, "-");

  return (
    <section
      style={{
        position: "relative",
        padding: "48px 48px 80px",
        overflow: "hidden",
      }}
    >
      <Glow x="20%" y="10%" size={900} opacity={0.3} color="124,58,237" />
      <Glow x="80%" y="30%" size={700} opacity={0.22} color={accentRgb} />
      <GridBg opacity={0.035} />
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto" }}>
        <div
          className="spec-hero-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.2fr",
            gap: 56,
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ marginBottom: 20 }}>
              <Breadcrumb spec={spec} accent={accent} />
            </div>
            <div
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono, ui-monospace, monospace)",
                fontSize: 11,
                color: "var(--ld-fg-muted, var(--fg-muted))",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              {spec.eyebrow}
            </div>
            <h1
              style={{
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                fontWeight: 700,
                fontSize: "clamp(40px, 5vw, 64px)",
                letterSpacing: "-0.04em",
                lineHeight: 1.0,
                margin: 0,
                color: "var(--ld-fg, var(--fg))",
              }}
            >
              {spec.heroTitle}
            </h1>
            <p
              style={{
                fontSize: 18,
                color: "var(--ld-fg-muted, var(--fg-muted))",
                marginTop: 22,
                lineHeight: 1.55,
                maxWidth: 540,
              }}
            >
              {spec.heroSub}
            </p>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginTop: 30,
                flexWrap: "wrap",
              }}
            >
              <Link
                href="/signup"
                style={{
                  padding: "14px 22px",
                  borderRadius: 10,
                  background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
                  color: "white",
                  fontWeight: 500,
                  fontSize: 14,
                  boxShadow:
                    "0 10px 30px -8px rgba(124,58,237,0.6), inset 0 1px 0 rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                Prueba gratis 14 días →
              </Link>
              <Link
                href="/#demo"
                style={{
                  padding: "14px 22px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--ld-border, var(--border))",
                  color: "var(--ld-fg, var(--fg))",
                  fontWeight: 500,
                  fontSize: 14,
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                Ver demo en vivo
              </Link>
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                marginTop: 24,
                fontSize: 11,
                color: "var(--ld-fg-muted, var(--fg-muted))",
                flexWrap: "wrap",
              }}
            >
              <span>✓ Sin tarjeta</span>
              <span>✓ Migración gratis</span>
              <span>✓ Cancela cuando quieras</span>
            </div>
          </div>

          <div style={{ position: "relative", minWidth: 0 }}>
            <BrowserFrame
              url={`app.mediflow.mx/${urlSlug}`}
              style={{ width: "100%", maxWidth: 560, overflow: "hidden" }}
            >
              <div style={{ width: 560, height: 560 * (560 / 960) }}>
                <div
                  style={{
                    transform: `scale(${560 / 960})`,
                    transformOrigin: "top left",
                    width: 960,
                    height: 560,
                  }}
                >
                  <Mock />
                </div>
              </div>
            </BrowserFrame>
          </div>
        </div>

        {/* Metrics strip */}
        <div
          className="spec-metrics-strip"
          style={{
            marginTop: 56,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            border: "1px solid var(--ld-border, var(--border))",
            borderRadius: 14,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))",
            backdropFilter: "blur(20px)",
          }}
        >
          {spec.metricsStrip.map(([v, l], i) => (
            <div
              key={i}
              style={{
                padding: "22px 24px",
                borderLeft:
                  i > 0 ? "1px solid var(--ld-border, var(--border))" : "none",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 700,
                  fontSize: 32,
                  letterSpacing: "-0.03em",
                  color: accent,
                }}
              >
                {v}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                  marginTop: 4,
                }}
              >
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .spec-hero-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
          .spec-metrics-strip { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </section>
  );
}

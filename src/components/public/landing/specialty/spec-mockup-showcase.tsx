import type { Specialty } from "@/lib/specialty-data";
import { BrowserFrame } from "../primitives/browser-frame";
import { Glow } from "../primitives/glow";
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

export function SpecMockupShowcase({ spec }: { spec: Specialty }) {
  const Mock = getSpecialtyMockup(spec.mockupKey);
  const accent = spec.accent;
  const accentRgb = accentToRgb(accent);
  return (
    <section
      style={{
        position: "relative",
        padding: "100px 48px",
        overflow: "hidden",
      }}
    >
      <Glow x="50%" y="50%" size={1000} opacity={0.15} color={accentRgb} />
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
          <div
            style={{
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              fontSize: 11,
              color: accent,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            El producto
          </div>
          <h2
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 600,
              fontSize: 44,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
              margin: 0,
              color: "var(--ld-fg, var(--fg))",
            }}
          >
            Diseñado para {spec.name.toLowerCase()}, no genérico.
          </h2>
          <p
            style={{
              fontSize: 16,
              color: "var(--ld-fg-muted, var(--fg-muted))",
              marginTop: 18,
              lineHeight: 1.5,
            }}
          >
            Cada especialidad tiene su propio flujo. Lo sabemos porque hablamos
            con cientos de clínicas antes de construirlo.
          </p>
        </div>
        <BrowserFrame
          url={`app.mediflow.mx/${spec.mockupKey}`}
          style={{ maxWidth: 1080, margin: "0 auto", overflow: "hidden" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <Mock />
          </div>
        </BrowserFrame>
      </div>
    </section>
  );
}

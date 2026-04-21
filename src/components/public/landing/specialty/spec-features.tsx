import type { Specialty } from "@/lib/specialty-data";
import { SpecIcon } from "../primitives/spec-icon";

export function SpecFeatures({ spec }: { spec: Specialty }) {
  const accent = spec.accent;
  return (
    <section
      style={{
        position: "relative",
        padding: "100px 48px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <div style={{ maxWidth: 640, marginBottom: 56 }}>
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
          Features
        </div>
        <h2
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Hecho para {spec.name.toLowerCase()}.<br />
          Sin atajos.
        </h2>
      </div>
      <div
        className="spec-features-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}
      >
        {spec.features.map((f, i) => (
          <div
            key={i}
            style={{
              padding: 26,
              borderRadius: 16,
              background: `linear-gradient(180deg, ${accent}0a, transparent 70%), rgba(255,255,255,0.02)`,
              border: `1px solid ${accent}1f`,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              transition: "all 0.25s",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: accent + "18",
                border: `1px solid ${accent}33`,
                display: "grid",
                placeItems: "center",
                color: accent,
              }}
            >
              <SpecIcon type={f.icon} size={22} />
            </div>
            <div
              style={{
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                fontWeight: 600,
                fontSize: 17,
                letterSpacing: "-0.02em",
                color: "var(--ld-fg, var(--fg))",
                lineHeight: 1.2,
              }}
            >
              {f.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ld-fg-muted, var(--fg-muted))",
                lineHeight: 1.55,
              }}
            >
              {f.desc}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .spec-features-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 600px) {
          .spec-features-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

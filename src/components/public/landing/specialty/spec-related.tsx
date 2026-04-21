import Link from "next/link";
import { SPECIALTIES } from "@/lib/specialty-data";

export function SpecRelated({ currentSlug }: { currentSlug: string }) {
  const others = Object.values(SPECIALTIES)
    .filter((s) => s.slug !== currentSlug)
    .slice(0, 4);

  return (
    <section
      style={{
        padding: "80px 48px 40px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          fontSize: 11,
          color: "var(--ld-fg-muted, var(--fg-muted))",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          marginBottom: 24,
        }}
      >
        Otras especialidades
      </div>
      <div
        className="spec-related-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        {others.map((s) => (
          <Link
            key={s.slug}
            href={`/${s.slug}`}
            style={{ textDecoration: "none" }}
          >
            <div
              style={{
                padding: 20,
                borderRadius: 14,
                background: `linear-gradient(180deg, ${s.accent}0a, transparent 70%), rgba(255,255,255,0.02)`,
                border: `1px solid ${s.accent}22`,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: s.accent,
                  fontFamily:
                    "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {s.category}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 600,
                  fontSize: 16,
                  color: "var(--ld-fg, var(--fg))",
                  marginTop: 6,
                  letterSpacing: "-0.015em",
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                  marginTop: 6,
                }}
              >
                {s.tagline} →
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .spec-related-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 500px) {
          .spec-related-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

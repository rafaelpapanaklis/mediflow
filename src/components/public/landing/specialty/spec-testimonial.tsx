import type { Specialty } from "@/lib/specialty-data";

export function SpecTestimonial({ spec }: { spec: Specialty }) {
  const t = spec.testimonial;
  const accent = spec.accent;
  const initials = t.name.split(" ").slice(-2).map((n) => n[0]).join("");
  return (
    <section
      style={{ padding: "100px 48px", maxWidth: 1080, margin: "0 auto" }}
    >
      <div
        style={{
          padding: "48px 56px",
          borderRadius: 20,
          background: `linear-gradient(135deg, ${accent}14, rgba(124,58,237,0.06))`,
          border: `1px solid ${accent}33`,
          boxShadow: `0 0 80px ${accent}20`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "5px 12px",
            borderRadius: 100,
            background: "#34d39922",
            border: "1px solid #34d39944",
            fontSize: 11,
            color: "#34d399",
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            marginBottom: 24,
          }}
        >
          {t.metric}
        </div>
        <div
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: "-0.015em",
            lineHeight: 1.35,
            color: "var(--ld-fg, var(--fg))",
            marginBottom: 28,
          }}
        >
          &ldquo;{t.q}&rdquo;
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            paddingTop: 24,
            borderTop: "1px solid var(--ld-border, var(--border))",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 46,
              background: `linear-gradient(135deg, ${accent}, ${accent}77)`,
              display: "grid",
              placeItems: "center",
              color: "white",
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            {initials}
          </div>
          <div>
            <div
              style={{
                fontSize: 14,
                color: "var(--ld-fg, var(--fg))",
                fontWeight: 500,
              }}
            >
              {t.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--ld-fg-muted, var(--fg-muted))",
              }}
            >
              {t.role} · {t.city}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import type { Specialty } from "@/lib/specialty-data";
import { Glow } from "../primitives/glow";

export function SpecFinalCTA({ spec }: { spec: Specialty }) {
  const accent = spec.accent;
  return (
    <section
      style={{
        padding: "100px 48px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Glow x="50%" y="50%" size={1200} opacity={0.4} />
      <div
        style={{
          position: "relative",
          maxWidth: 900,
          margin: "0 auto",
          textAlign: "center",
          padding: "72px 48px",
          borderRadius: 24,
          background:
            "linear-gradient(180deg, rgba(124,58,237,0.1), rgba(124,58,237,0.02))",
          border: "1px solid rgba(124,58,237,0.3)",
          boxShadow: "0 0 80px rgba(124,58,237,0.2)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 700,
            fontSize: 56,
            letterSpacing: "-0.04em",
            lineHeight: 1.0,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Tu clínica merece
          <br />
          <span
            style={{
              background: `linear-gradient(90deg, #c4b5fd, ${accent})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            mejor software.
          </span>
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            maxWidth: 520,
            margin: "22px auto 32px",
            lineHeight: 1.55,
          }}
        >
          14 días completos de PRO. Cancela cuando quieras. Migramos tus datos gratis.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/signup"
            style={{
              padding: "14px 24px",
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
            href="/contact?intent=demo"
            style={{
              padding: "14px 24px",
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
            Agendar demo
          </Link>
        </div>
      </div>
    </section>
  );
}

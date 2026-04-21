import Link from "next/link";

export function FinalCTA() {
  return (
    <section
      style={{
        position: "relative",
        padding: "120px 48px",
        overflow: "hidden",
      }}
    >
      {/* Ambient backgrounds */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(124,58,237,0.18), transparent 55%), radial-gradient(ellipse at 80% 60%, rgba(52,211,153,0.10), transparent 55%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: 900,
          margin: "0 auto",
          textAlign: "center",
          padding: "80px 48px",
          borderRadius: 24,
          background:
            "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(52,211,153,0.08))",
          border: "1px solid rgba(124,58,237,0.3)",
          boxShadow: "0 0 80px rgba(124,58,237,0.2)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 700,
            fontSize: "clamp(32px, 5vw, 48px)",
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          ¿Listo para ver MediFlow en tu clínica?
        </h2>

        <p
          style={{
            fontSize: 17,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            maxWidth: 560,
            margin: "24px auto 36px",
            lineHeight: 1.55,
          }}
        >
          Empieza gratis hoy. 14 días sin cargo. Cancela cuando quieras.
        </p>

        <div
          className="ld-cta-buttons"
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
              textDecoration: "none",
              boxShadow:
                "0 10px 30px -8px rgba(124,58,237,0.6), inset 0 1px 0 rgba(255,255,255,0.2)",
              transition: "all 0.2s",
            }}
          >
            Empieza gratis →
          </Link>
          <Link
            href="/demo"
            style={{
              padding: "14px 24px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--ld-fg, var(--fg))",
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
              transition: "all 0.2s",
            }}
          >
            Agendar demo
          </Link>
        </div>

        <div
          style={{
            marginTop: 28,
            display: "flex",
            justifyContent: "center",
            gap: 24,
            flexWrap: "wrap",
            fontSize: 12,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            letterSpacing: "0.02em",
          }}
        >
          <span>✓ Sin tarjeta</span>
          <span>✓ Migración incluida</span>
          <span>✓ Soporte en español</span>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .ld-cta-buttons > a {
            width: 100%;
            text-align: center;
          }
        }
      `}</style>
    </section>
  );
}

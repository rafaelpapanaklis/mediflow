import { Logo } from "../../landing/primitives/logo";
import { FloatCard } from "../../landing/primitives/float-card";
import { WhatsAppCard } from "../../landing/mockups/whatsapp-card";

export function LoginVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 520, gap: 32 }}>
      {/* Logo arriba */}
      <div>
        <Logo size={26} color="var(--ld-brand-light)" />
      </div>

      {/* Testimonial grande centrado */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 520 }}>
        <div
          aria-hidden="true"
          style={{
            fontSize: 56,
            lineHeight: 1,
            color: "var(--ld-brand-light)",
            opacity: 0.4,
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          “
        </div>
        <p
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "-0.015em",
            lineHeight: 1.3,
            color: "var(--ld-fg)",
            margin: 0,
            marginBottom: 28,
          }}
        >
          MediFlow me ahorra 10 horas de papeleo cada semana.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 600,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            FR
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ld-fg)" }}>Dr. Fernando Ruiz</div>
            <div style={{ fontSize: 12, color: "var(--ld-fg-muted)" }}>Clínica Dental Roma Norte</div>
          </div>
        </div>

        {/* Mockup WhatsApp flotante (absolute decoration) */}
        <div
          className="ld-float"
          style={{
            position: "absolute",
            right: 48,
            top: "50%",
            transform: "translateY(-20%)",
            zIndex: 0,
            display: "none",
          }}
        >
          <FloatCard>
            <WhatsAppCard />
          </FloatCard>
        </div>
      </div>

      {/* Stat abajo */}
      <div
        style={{
          paddingTop: 20,
          borderTop: "1px solid var(--ld-border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "var(--ld-fg)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: "-0.02em",
            }}
          >
            +2,400
          </span>
        </div>
        <span style={{ fontSize: 12, color: "var(--ld-fg-muted)" }}>
          clínicas confían en MediFlow
        </span>
      </div>
    </div>
  );
}

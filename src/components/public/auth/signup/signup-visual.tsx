import { Logo } from "../../landing/primitives/logo";
import { FloatCard } from "../../landing/primitives/float-card";
import { DashboardMockup } from "../../landing/mockups/dashboard-mockup";
import { WhatsAppCard } from "../../landing/mockups/whatsapp-card";

const BENEFITS = [
  "Acceso completo a todos los módulos",
  "Configuración guiada en menos de 10 minutos",
  "Importación gratuita de tus pacientes existentes",
  "Soporte 1-a-1 durante el trial",
  "Cancela cuando quieras sin cargo",
  "Tus datos siempre son tuyos — exporta cuando quieras",
];

export function SignupVisual() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 520,
        gap: 28,
        position: "relative",
      }}
    >
      {/* Logo */}
      <div>
        <Logo size={26} color="var(--ld-brand-light)" />
      </div>

      {/* Trial badge (pulsing dot) */}
      <div
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 10,
          padding: "6px 12px",
          borderRadius: 100,
          background: "rgba(52,211,153,0.1)",
          border: "1px solid rgba(52,211,153,0.3)",
          fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#34d399",
          fontWeight: 600,
        }}
      >
        <span
          className="ld-pulse"
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#34d399",
            boxShadow: "0 0 10px #34d399",
          }}
        />
        Prueba gratis · 14 días · Cancela cuando quieras
      </div>

      {/* H1 + sub */}
      <div style={{ maxWidth: 560 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: "clamp(36px, 4.6vw, 52px)",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            color: "var(--ld-fg)",
          }}
        >
          Empieza a automatizar tu clínica en minutos
        </h1>
        <p
          style={{
            margin: "16px 0 0 0",
            fontSize: 15,
            lineHeight: 1.55,
            color: "var(--ld-fg-muted)",
          }}
        >
          Únete a 2,400+ clínicas que ya gestionan sus pacientes, citas y facturación con
          MediFlow.
        </p>
      </div>

      {/* Benefits list */}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 10,
          maxWidth: 560,
        }}
      >
        {BENEFITS.map(benefit => (
          <li
            key={benefit}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: "var(--ld-fg)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "rgba(52,211,153,0.15)",
                border: "1px solid rgba(52,211,153,0.35)",
                display: "grid",
                placeItems: "center",
                marginTop: 1,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6 L5 9 L10 3"
                  stroke="#34d399"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{benefit}</span>
          </li>
        ))}
      </ul>

      {/* Floating mockup collage */}
      <div
        aria-hidden="true"
        className="signup-visual__collage"
        style={{
          position: "absolute",
          right: -40,
          bottom: 140,
          pointerEvents: "none",
          zIndex: 0,
          display: "none",
        }}
      >
        <div
          className="ld-float"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            transform: "rotate(-3deg)",
            opacity: 0.75,
          }}
        >
          <FloatCard style={{ padding: 0, overflow: "hidden", width: 336, height: 196 }}>
            <DashboardMockup scale={0.35} animate={false} />
          </FloatCard>
        </div>
        <div
          className="ld-float"
          style={{
            position: "absolute",
            right: 120,
            top: 130,
            animationDelay: "1.5s",
          }}
        >
          <WhatsAppCard />
        </div>
      </div>

      {/* Spacer to push testimonial down */}
      <div style={{ flex: 1, minHeight: 20 }} />

      {/* Testimonial compacto */}
      <div
        style={{
          paddingTop: 20,
          borderTop: "1px solid var(--ld-border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          maxWidth: 560,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "linear-gradient(135deg, hsl(270, 70%, 65%), hsl(160, 60%, 50%))",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          AP
        </div>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.4,
              color: "var(--ld-fg)",
              fontWeight: 500,
            }}
          >
            “Lo más fácil que he configurado. Lista en 8 minutos.”
          </p>
          <div style={{ fontSize: 11.5, color: "var(--ld-fg-muted)", marginTop: 3 }}>
            Dra. Ana Paredes · Clínica Luna
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 1200px) {
          .signup-visual__collage {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
}

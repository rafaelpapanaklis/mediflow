import { Glow } from "./primitives/glow";
import { GridBg } from "./primitives/grid-bg";
import { Pill } from "./primitives/pill";
import { FloatCard } from "./primitives/float-card";
import { CTAButtons } from "./primitives/cta-buttons";
import { DashboardMockup } from "./mockups/dashboard-mockup";
import { WhatsAppCard } from "./mockups/whatsapp-card";
import { MiniRadio } from "./mockups/mini-radio";

export function Hero() {
  return (
    <section style={{ position: "relative", overflow: "hidden", paddingBottom: 80 }}>
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, #1a0b2e 0%, var(--ld-bg) 70%)",
        pointerEvents: "none",
      }} />
      <Glow x="50%" y="5%" size={1400} opacity={0.5} />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 85% 40%, rgba(52,211,153,0.12), transparent 50%)",
      }} />
      <GridBg opacity={0.035} />

      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: "120px 48px 0" }}>
        <div className="ld-hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 56, alignItems: "center" }}>
          <div>
            <div style={{ marginBottom: 24 }}><Pill>Hecho en México · CFDI 4.0 nativo</Pill></div>
            <h1 style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 700,
              fontSize: "clamp(40px, 6vw, 72px)",
              letterSpacing: "-0.045em",
              lineHeight: 0.95,
              margin: 0,
              marginBottom: 24,
              color: "var(--ld-fg)",
            }}>
              El sistema operativo<br />
              <span style={{
                background: "linear-gradient(90deg, #c4b5fd 0%, #7c3aed 50%, #34d399 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}>de tu clínica.</span>
            </h1>
            <p style={{ fontSize: 18, color: "var(--ld-fg-muted)", maxWidth: 500, lineHeight: 1.55, marginBottom: 32 }}>
              Agenda, expedientes, facturación CFDI, WhatsApp e IA para radiografías — en una sola plataforma diseñada para clínicas mexicanas.
            </p>
            <CTAButtons />
            <div style={{ marginTop: 36, display: "flex", gap: 22, fontSize: 12, color: "var(--ld-fg-muted)", flexWrap: "wrap" }}>
              <span>✓ Sin cargo hoy</span>
              <span>✓ 14 días gratis</span>
              <span>✓ Soporte en español</span>
              <span>✓ Migración incluida</span>
            </div>
          </div>

          <div className="ld-hero-collage" style={{ position: "relative", height: 560 }}>
            <div style={{ position: "absolute", top: 0, right: 0, width: 520, zIndex: 2 }}>
              <FloatCard title="agenda.semana">
                <div style={{ overflow: "hidden", borderRadius: 10 }}>
                  <DashboardMockup scale={0.52} animate />
                </div>
              </FloatCard>
            </div>

            <div style={{ position: "absolute", top: 260, left: -20, width: 260, zIndex: 3 }}>
              <FloatCard title="factura · CFDI 4.0">
                <div style={{ fontSize: 11, color: "var(--ld-fg-muted)", marginBottom: 8, fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)" }}>Folio AB-00342</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: "var(--ld-fg)" }}>Consulta general</span>
                  <span style={{ color: "var(--ld-fg)" }}>$800.00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: "var(--ld-fg-muted)" }}>IVA 16%</span>
                  <span style={{ color: "var(--ld-fg-muted)" }}>$128.00</span>
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "8px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-sora, 'Sora', sans-serif)", fontWeight: 600, color: "var(--ld-fg)" }}>
                  <span>Total</span><span>$928.00</span>
                </div>
                <div style={{
                  marginTop: 12, padding: "6px 10px", borderRadius: 6,
                  background: "rgba(52,211,153,0.12)",
                  border: "1px solid rgba(52,211,153,0.25)",
                  fontSize: 11, color: "#34d399",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span>✓</span> Timbrada ante SAT
                </div>
              </FloatCard>
            </div>

            <div style={{ position: "absolute", top: 380, right: 40, width: 240, zIndex: 3 }}>
              <FloatCard title="radiografía · IA">
                <MiniRadio />
                <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 10, fontWeight: 500 }}>⚠ 2 caries detectadas</div>
                <div style={{ fontSize: 10, color: "var(--ld-fg-muted)" }}>Molar superior y premolar inferior</div>
              </FloatCard>
            </div>

            <div style={{ position: "absolute", top: 180, left: -40, zIndex: 4 }}>
              <WhatsAppCard />
            </div>
          </div>
        </div>

        <div style={{
          display: "flex", justifyContent: "center", gap: 40, flexWrap: "wrap",
          fontSize: 11, color: "var(--ld-fg-muted)",
          textTransform: "uppercase", letterSpacing: "0.15em",
          marginTop: 100, paddingTop: 32,
          borderTop: "1px solid var(--ld-border)",
        }}>
          {[["+800","clínicas activas"],["17","especialidades"],["2.4M","citas gestionadas"],["99.9%","uptime"]].map(([v, l], i, arr) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <span>
                <b style={{ color: "var(--ld-fg)", fontSize: 14, fontWeight: 500, letterSpacing: "-0.02em", textTransform: "none" }}>{v}</b> {l}
              </span>
              {i < arr.length - 1 && <span style={{ opacity: 0.3 }}>•</span>}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .ld-hero-grid { grid-template-columns: 1fr !important; }
          .ld-hero-collage { height: auto !important; min-height: 480px; }
        }
      `}</style>
    </section>
  );
}

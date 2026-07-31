import Link from "next/link";
import type { CSSProperties } from "react";
import { FINAL_CTA } from "./landing-data";

const cta: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 52,
  padding: "0 30px",
  fontWeight: 700,
  fontSize: 16.5,
  borderRadius: 12,
};

/** Cierre oscuro con trama de puntos. El precio viene de plan_configs. */
export function FinalCta({ firstMonthFrom }: { firstMonthFrom: string }) {
  return (
    <section
      id="cta"
      style={{
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(700px 420px at 78% 0%,rgba(124,58,237,0.4),rgba(124,58,237,0) 62%),radial-gradient(800px 480px at 8% 20%,rgba(37,99,235,0.45),rgba(37,99,235,0) 60%),linear-gradient(150deg,#0b1220,#101a3c 60%,#131a3a)",
      }}
    >
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px,transparent 1px)", backgroundSize: "26px 26px", opacity: 0.5 }} />
      <div style={{ position: "relative", maxWidth: 900, margin: "0 auto", padding: "clamp(60px,7.5vw,104px) 20px", textAlign: "center" }}>
        <h2 data-reveal="" className="dcv4-balance" style={{ fontSize: "clamp(28px,3.8vw,48px)", lineHeight: 1.06, letterSpacing: "-0.035em", fontWeight: 800, color: "#ffffff" }}>
          {FINAL_CTA.title}
        </h2>
        {/* precio dinámico: plan_configs */}
        <p data-reveal="" className="dcv4-pretty" style={{ margin: "18px auto 0", fontSize: "clamp(16px,1.5vw,18.5px)", lineHeight: 1.6, color: "#cbd5e1", maxWidth: "46ch" }}>
          {FINAL_CTA.subtitleLead}
          <strong style={{ color: "#ffffff", fontWeight: 800 }}>{firstMonthFrom}</strong>.
        </p>
        <div data-reveal="" style={{ marginTop: 30, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <Link href="/signup" className="dcv2-btn-white" style={{ ...cta, background: "#ffffff", color: "#1d4ed8", boxShadow: "0 16px 32px -16px rgba(2,6,23,0.7)" }}>
            {FINAL_CTA.ctaPrimary}
          </Link>
          <a href="#funciones" className="dcv4-btn-glass" style={{ ...cta, background: "rgba(255,255,255,0.08)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.4)" }}>
            {FINAL_CTA.ctaSecondary}
          </a>
        </div>
        <p data-reveal="" style={{ marginTop: 20, fontSize: 14, color: "#cbd5e1" }}>{FINAL_CTA.bullets}</p>
      </div>
    </section>
  );
}

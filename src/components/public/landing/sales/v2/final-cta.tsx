import Link from "next/link";
import { FINAL_CTA } from "./landing-data";

export function FinalCta() {
  return (
    <section aria-label="Crea tu cuenta" style={{ background: "linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 55%,#2563eb 100%)", padding: "80px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", color: "#fff" }}>
        <h2 style={{ fontSize: "clamp(28px,3.6vw,42px)", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, margin: "0 0 14px" }}>{FINAL_CTA.title}</h2>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "#bfdbfe", margin: "0 0 30px" }}>{FINAL_CTA.subtitle}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/signup" className="dcv2-btn-white" style={{ background: "#fff", color: "#1d4ed8", fontSize: 16, fontWeight: 800, padding: "16px 32px", borderRadius: 12, boxShadow: "0 12px 30px rgba(2,8,30,.3)" }}>
            {FINAL_CTA.ctaPrimary}
          </Link>
          <a href="#funciones" className="dcv2-btn-glass" style={{ background: "rgba(255,255,255,.12)", border: "1.5px solid rgba(255,255,255,.4)", color: "#fff", fontSize: 16, fontWeight: 700, padding: "16px 32px", borderRadius: 12 }}>
            {FINAL_CTA.ctaSecondary}
          </a>
        </div>
        <div style={{ marginTop: 22, fontSize: 13.5, color: "#93c5fd" }}>{FINAL_CTA.bullets}</div>
      </div>
    </section>
  );
}

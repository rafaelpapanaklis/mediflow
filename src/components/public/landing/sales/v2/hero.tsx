import Link from "next/link";
import { HERO } from "./landing-data";
import { HeroDashboardMock } from "./mockups";

export function Hero() {
  return (
    <header id="inicio" style={{ background: "radial-gradient(1200px 620px at 50% -120px,#dbeafe 0%,#f8fafc 55%,#fff 100%)", padding: "72px 20px 60px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 48, alignItems: "center" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 999, marginBottom: 20 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.5-7 10-4-1.5-7-5.6-7-10V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
            {HERO.badge}
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.6vw,54px)", lineHeight: 1.08, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 18px" }}>{HERO.title}</h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#475569", margin: "0 0 28px", maxWidth: 520 }}>{HERO.subtitle}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/signup" className="dcv2-btn-primary" style={{ fontSize: 16, padding: "15px 28px", borderRadius: 12, boxShadow: "0 10px 26px rgba(37,99,235,.32)" }}>
              {HERO.ctaPrimary}
            </Link>
            <a href="#precios" className="dcv2-btn-primary" style={{ fontSize: 16, padding: "15px 28px", borderRadius: 12, boxShadow: "0 10px 26px rgba(37,99,235,.32)" }}>
              {HERO.ctaSecondary}
            </a>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 22, fontSize: 13.5, color: "#64748b", fontWeight: 500 }}>
            {HERO.bullets.map((b) => (
              <span key={b}>✓ {b}</span>
            ))}
          </div>
        </div>

        {/* Mockup del dashboard real + toast flotante */}
        <div aria-hidden="true" style={{ position: "relative" }}>
          <HeroDashboardMock />
          <div style={{ position: "absolute", right: -8, bottom: -16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.14)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ display: "flex", width: 28, height: 28, borderRadius: "50%", background: "#dcfce7", alignItems: "center", justifyContent: "center", color: "#16a34a", fontWeight: 800, fontSize: 13 }}>✓</span>
            <span style={{ fontSize: 12, color: "#334155" }}><b>Recordatorio enviado</b><br /><span style={{ color: "#94a3b8" }}>WhatsApp · hace 1 min</span></span>
          </div>
        </div>
      </div>
    </header>
  );
}

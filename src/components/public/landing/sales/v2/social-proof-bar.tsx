import { STATS } from "./landing-data";

/** Banda de stats destacada: degradado azul, números gigantes blancos (reference §3). */
export function SocialProofBar() {
  return (
    <section aria-label="Confianza" style={{ background: "linear-gradient(120deg,#1e3a8a 0%,#1d4ed8 60%,#2563eb 100%)", padding: "38px 20px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 26, textAlign: "center" }}>
        {STATS.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: "clamp(36px,4vw,48px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "#fff" }}>{s.value}</div>
            <div style={{ marginTop: 8, fontSize: 14.5, color: "#bfdbfe", fontWeight: 600 }}>{s.label}</div>
            {"trend" in s && s.trend && (
              <div style={{ marginTop: 7 }}>
                <span style={{ display: "inline-block", background: "rgba(74,222,128,.16)", border: "1px solid rgba(74,222,128,.45)", color: "#4ade80", fontWeight: 800, fontSize: 13, borderRadius: 999, padding: "4px 12px" }}>{s.trend}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

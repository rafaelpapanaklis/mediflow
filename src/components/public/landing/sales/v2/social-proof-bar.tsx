import { STATS } from "./landing-data";

export function SocialProofBar() {
  return (
    <section aria-label="Confianza" style={{ borderTop: "1px solid #eef2f7", borderBottom: "1px solid #eef2f7", background: "#fff", padding: "26px 20px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "14px 56px", textAlign: "center" }}>
        {STATS.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f172a" }}>{s.value}</div>
            <div style={{ fontSize: 13.5, color: "#64748b", fontWeight: 500 }}>{s.label}</div>
            {"trend" in s && s.trend && (
              <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 700 }}>{s.trend}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

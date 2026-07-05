import { COMPARISON } from "./landing-data";

export function Comparison() {
  return (
    <section id="comparativa" style={{ scrollMarginTop: 80, background: "#fff", padding: "80px 20px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 660, margin: "0 auto 40px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#2563eb", marginBottom: 12 }}>{COMPARISON.eyebrow}</div>
          <h2 style={{ fontSize: "clamp(28px,3.4vw,40px)", lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 12px" }}>{COMPARISON.title}</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: "#475569", margin: 0 }}>{COMPARISON.subtitle}</p>
        </div>
        {/* La tabla scrollea en su propio contenedor; la página nunca scrollea horizontal. */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640, border: "1px solid #e8edf5", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.15fr", background: "#f8fafc", borderBottom: "1px solid #e8edf5" }}>
              <div style={{ padding: "16px 18px", fontSize: 13, fontWeight: 700, color: "#64748b" }} />
              <div style={{ padding: "16px 10px", fontSize: 13.5, fontWeight: 700, color: "#64748b", textAlign: "center" }}>{COMPARISON.columns[0]}</div>
              <div style={{ padding: "16px 10px", fontSize: 13.5, fontWeight: 700, color: "#64748b", textAlign: "center" }}>{COMPARISON.columns[1]}</div>
              <div style={{ padding: "16px 10px", fontSize: 14, fontWeight: 800, color: "#1d4ed8", textAlign: "center", background: "#eff6ff" }}>{COMPARISON.columns[2]}</div>
            </div>
            {COMPARISON.rows.map((row) => (
              <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.15fr", borderBottom: "1px solid #eef2f7", background: "#fff" }}>
                <div style={{ padding: "13px 18px", fontSize: 14, fontWeight: 600, color: "#334155", display: "flex", alignItems: "center" }}>{row.label}</div>
                <div style={{ padding: "13px 10px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "#94a3b8", fontWeight: 600 }}>{row.paper}</div>
                <div style={{ padding: "13px 10px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "#94a3b8", fontWeight: 600 }}>{row.traditional}</div>
                <div style={{ padding: "13px 10px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", background: "#eff6ff" }}>
                  <span style={{ display: "flex", width: 24, height: 24, borderRadius: "50%", background: "#dcfce7", color: "#15803d", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }} aria-label="Incluido">✓</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

import { GRID_FEATURES } from "./landing-data";

export function FeaturesGrid() {
  return (
    <section aria-label="Más funciones" style={{ background: "#f8fafc", padding: "20px 20px 80px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h3 style={{ textAlign: "center", fontSize: "clamp(22px,2.6vw,28px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 30px" }}>Y todo lo demás, incluido</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14 }}>
          {GRID_FEATURES.map((g) => (
            <div key={g.title} className="dcv2-gridcard" style={{ background: "#fff", border: "1px solid #e8edf5", borderRadius: 14, padding: 18 }}>
              <div style={{ display: "flex", width: 34, height: 34, borderRadius: 9, background: "#eff6ff", color: "#1d4ed8", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, marginBottom: 10 }} aria-hidden="true">{g.glyph}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{g.title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "#64748b" }}>{g.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

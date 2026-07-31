import { GRID_FEATURES, GRID_TITLE } from "./landing-data";

/** "Y todo lo demás, incluido": rejilla de 16 tarjetas pequeñas. */
export function FeaturesGrid() {
  return (
    <section aria-label="Todo lo demás incluido" style={{ background: "#f8fafc" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
        <h2 data-reveal="" className="dcv4-balance" style={{ textAlign: "center", fontSize: "clamp(26px,3.2vw,40px)", lineHeight: 1.1, letterSpacing: "-0.032em", fontWeight: 800 }}>
          {GRID_TITLE}
        </h2>
        <div style={{ marginTop: "clamp(28px,3.6vw,44px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(248px,1fr))", gap: 12 }}>
          {GRID_FEATURES.map((f) => (
            <article key={f.title} data-reveal="" className="dcv2-gridcard" style={{ background: "#ffffff", border: "1px solid #e8edf4", borderRadius: 14, padding: 20 }}>
              <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 9, background: f.warm ? "#fffbeb" : "#eff6ff", color: f.warm ? "#b45309" : "#1d4ed8", fontSize: 14, fontWeight: 800 }}>
                {f.glyph}
              </span>
              <h3 style={{ marginTop: 12, fontSize: 15.5, fontWeight: 700 }}>{f.title}</h3>
              <p style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.55, color: "#64748b" }}>{f.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

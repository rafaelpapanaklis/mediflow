import { TESTIMONIALS } from "./landing-data";

export function Testimonials() {
  return (
    <section aria-label="Testimonios" style={{ background: "#f8fafc", padding: "80px 20px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h2 style={{ textAlign: "center", fontSize: "clamp(28px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 40px" }}>{TESTIMONIALS.title}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18 }}>
          {TESTIMONIALS.items.map((t) => (
            <figure key={t.name} style={{ background: "#fff", border: "1px solid #e8edf5", borderRadius: 18, padding: 26, margin: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ color: "#f59e0b", fontSize: 15, letterSpacing: 2 }} aria-label="5 estrellas">★★★★★</div>
              <blockquote style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: "#334155" }}>"{t.quote}"</blockquote>
              <figcaption style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto" }}>
                <span style={{ display: "flex", width: 42, height: 42, borderRadius: "50%", background: "#dbeafe", color: "#1d4ed8", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15 }} aria-hidden="true">{t.initials}</span>
                <span><b style={{ fontSize: 14.5, display: "block" }}>{t.name}</b><span style={{ fontSize: 13, color: "#64748b" }}>{t.role}</span></span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { MODULE_PAGES, MODULE_PAGES_HEADER } from "./landing-data";

/**
 * Las 8 páginas de producto por módulo. Los slugs vienen tipados como
 * `ProductoSlug` (landing-data.ts), así que no pueden apuntar a una ruta que no
 * exista: si alguien inventa un slug, no compila.
 */
export function ModulePages() {
  return (
    <section aria-label="Páginas de módulos" style={{ background: "#ffffff", borderTop: "1px solid #eef2f7" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(52px,6.5vw,84px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 680, margin: "0 auto" }}>
          <span style={{ display: "inline-block", background: "#eff6ff", border: "1px solid #dbeafe", color: "#1d4ed8", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", borderRadius: 999, padding: "7px 15px", textTransform: "uppercase" }}>
            {MODULE_PAGES_HEADER.eyebrow}
          </span>
          <h2 className="dcv4-balance" style={{ marginTop: 18, fontSize: "clamp(25px,3.1vw,38px)", lineHeight: 1.1, letterSpacing: "-0.032em", fontWeight: 800 }}>
            {MODULE_PAGES_HEADER.title}
          </h2>
          <p style={{ marginTop: 12, fontSize: "clamp(15px,1.4vw,17px)", color: "#475569" }}>{MODULE_PAGES_HEADER.subtitle}</p>
        </div>
        <div style={{ marginTop: "clamp(26px,3.4vw,40px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(252px,1fr))", gap: 12 }}>
          {MODULE_PAGES.map((m) => (
            <Link
              key={m.slug}
              data-reveal=""
              href={`/${m.slug}`}
              className="dcv4-modlink"
              style={{ display: "flex", flexDirection: "column", gap: 10, background: "#ffffff", border: "1px solid #e8edf4", borderRadius: 14, padding: 20 }}
            >
              <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 9, background: m.color, color: "#ffffff", fontSize: 13, fontWeight: 800 }}>
                {m.glyph}
              </span>
              <span style={{ fontSize: 15.5, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.015em" }}>{m.title}</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "#64748b" }}>{m.desc}</span>
              <span style={{ marginTop: "auto", fontSize: 13.5, fontWeight: 700, color: "#1d4ed8" }}>
                Ver más <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

import { TESTIMONIALS } from "./landing-data";

/**
 * Carrusel infinito de testimonios. La pista lleva las 6 tarjetas DUPLICADAS y
 * se desplaza -50%, así que el bucle es continuo. Sólo anima `transform` y se
 * pausa al pasar el mouse (`.dcv4-marquee` en landing-v2.css).
 *
 * La copia duplicada va `aria-hidden` para no leer los testimonios dos veces.
 */
export function Testimonials() {
  const cards = TESTIMONIALS.items;
  return (
    <section aria-label="Testimonios" style={{ background: "#ffffff", overflow: "hidden" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,88px) 20px 0" }}>
        <h2 data-reveal="" className="dcv4-balance" style={{ textAlign: "center", fontSize: "clamp(26px,3.2vw,40px)", lineHeight: 1.1, letterSpacing: "-0.032em", fontWeight: 800 }}>
          {TESTIMONIALS.title}
        </h2>
      </div>
      <div style={{ position: "relative", marginTop: "clamp(28px,3.6vw,44px)", paddingBottom: "clamp(56px,7vw,88px)" }}>
        <div className="dcv4-marquee" style={{ display: "flex", gap: 18, width: "max-content", padding: "0 9px" }}>
          {[0, 1].map((copy) =>
            cards.map((t) => (
              <article
                key={`${copy}-${t.initials}`}
                aria-hidden={copy === 1 ? true : undefined}
                style={{ width: 300, flex: "0 0 auto", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 22, boxShadow: "0 18px 38px -30px rgba(15,23,42,0.4)" }}
              >
                <span aria-hidden="true" style={{ color: "#f59e0b", fontSize: 13, letterSpacing: 2 }}>★★★★★</span>
                <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#334155" }}>&ldquo;{t.quote}&rdquo;</p>
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%", background: t.bg, color: t.fg, fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
                    {t.initials}
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{t.role}</span>
                    <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>{t.place}</span>
                  </span>
                </div>
              </article>
            )),
          )}
        </div>
      </div>
    </section>
  );
}

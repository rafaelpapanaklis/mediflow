import Link from "next/link";
import type { CSSProperties } from "react";
import { FUNCIONES, FUNCIONES_HEADER } from "./landing-data";
import { LazyMockup } from "./lazy-mockup";

/**
 * Sección "Funciones": 6 tarjetas grandes, alternando fondo claro y oscuro,
 * cada una con su mockup del panel asomando por el borde inferior.
 *
 * Los 6 mockups van DIFERIDOS (todos caen por debajo del pliegue): el hueco lo
 * reserva `.dcv2-lazy--<name>` con el alto exacto medido en Chrome, así que el
 * montaje no mueve nada — ver lazy-mockup.tsx y landing-v2.css.
 */

const pillBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 38,
  padding: "0 18px",
  fontWeight: 700,
  fontSize: 13.5,
  borderRadius: 999,
};

const cardLight: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: 20,
  background: "linear-gradient(180deg,#eef5ff,#f8fafc 60%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  padding: "clamp(30px,3.6vw,46px) clamp(18px,2.4vw,30px) 0",
};

const cardDark: CSSProperties = {
  ...cardLight,
  background: "radial-gradient(420px 260px at 50% 0%,rgba(37,99,235,0.3),transparent 70%),#0b1220",
};

export function Funciones() {
  return (
    <section id="funciones" style={{ scrollMarginTop: 72, background: "linear-gradient(180deg,#f8fafc,#ffffff 26%)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,100px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          <span style={{ display: "inline-block", background: "#eff6ff", border: "1px solid #dbeafe", color: "#1d4ed8", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", borderRadius: 999, padding: "7px 15px", textTransform: "uppercase" }}>
            {FUNCIONES_HEADER.eyebrow}
          </span>
          <h2 className="dcv4-balance" style={{ marginTop: 18, fontSize: "clamp(28px,3.6vw,46px)", lineHeight: 1.08, letterSpacing: "-0.035em", fontWeight: 800 }}>
            {FUNCIONES_HEADER.title}
          </h2>
          <p className="dcv4-pretty" style={{ marginTop: 16, fontSize: "clamp(16px,1.5vw,18.5px)", lineHeight: 1.6, color: "#475569" }}>
            {FUNCIONES_HEADER.subtitle}
          </p>
        </div>

        <div style={{ marginTop: "clamp(36px,4.5vw,58px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))", gap: 14 }}>
          {FUNCIONES.map((f) => (
            <article key={f.id} data-reveal="" style={f.dark ? cardDark : cardLight}>
              <h3 className="dcv4-balance" style={{ fontSize: "clamp(23px,2.4vw,30px)", fontWeight: 800, letterSpacing: "-0.03em", color: f.dark ? "#ffffff" : "#0f172a" }}>
                {f.title}
              </h3>
              <p className="dcv4-pretty" style={{ margin: "10px auto 0", fontSize: "clamp(14.5px,1.3vw,16.5px)", lineHeight: 1.55, color: f.dark ? "#cbd5e1" : "#475569", maxWidth: "44ch" }}>
                {f.desc}
              </p>
              <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center" }}>
                <Link href={f.href} className="dcv4-pill-solid" style={{ ...pillBase, background: "#2563eb", color: "#ffffff" }}>
                  Más información
                </Link>
                <a
                  href="#precios"
                  className={f.dark ? "dcv4-pill-ghost-dark" : "dcv4-pill-ghost"}
                  style={{ ...pillBase, background: "transparent", color: f.dark ? "#93c5fd" : "#1d4ed8", border: `1px solid ${f.dark ? "rgba(147,197,253,0.5)" : "#93c5fd"}` }}
                >
                  Ver planes
                </a>
              </div>
              {f.note && <p style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>{f.note}</p>}
              <div aria-hidden="true" style={{ width: "100%" }}>
                <LazyMockup name={f.mockup} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

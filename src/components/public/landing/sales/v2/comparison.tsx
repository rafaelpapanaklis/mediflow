import type { CSSProperties } from "react";
import { COMPARISON } from "./landing-data";

/**
 * Tabla comparativa. Va en una rejilla CSS con `min-width:640px` dentro de un
 * contenedor con scroll horizontal PROPIO, así que en móvil se desliza sola sin
 * empujar el ancho de la página.
 */
const head: CSSProperties = { padding: "14px 10px", fontSize: 13, fontWeight: 700, color: "#475569", textAlign: "center" };
const row: CSSProperties = { display: "grid", gridTemplateColumns: "1.7fr 1fr 1.25fr 1fr", borderBottom: "1px solid #f1f5f9", alignItems: "center" };
const label: CSSProperties = { padding: "13px 18px", fontSize: 14, fontWeight: 600, color: "#0f172a" };
const dc: CSSProperties = { textAlign: "center", background: "#f5f9ff", alignSelf: "stretch", display: "grid", placeItems: "center", color: "#15803d", fontWeight: 800 };

/**
 * "✗" y "—" del diseño, pero en slate-500 y no slate-400: sobre blanco el
 * #94a3b8 se queda en 2.8:1 y no pasa AA (misma corrección que ya se hizo en
 * el resto de la landing).
 */
function Cell({ value }: { value: string }) {
  if (value === "✗") return <span style={{ textAlign: "center", color: "#64748b", fontWeight: 700 }}>✗</span>;
  if (value === "—") return <span style={{ textAlign: "center", color: "#64748b" }}>—</span>;
  return <span style={{ textAlign: "center", fontSize: 12.5, color: "#64748b" }}>{value}</span>;
}

export function Comparison() {
  return (
    <section id="comparativa" style={{ scrollMarginTop: 72, background: "#ffffff" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 680, margin: "0 auto" }}>
          <span style={{ display: "inline-block", background: "#eff6ff", border: "1px solid #dbeafe", color: "#1d4ed8", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", borderRadius: 999, padding: "7px 15px", textTransform: "uppercase" }}>
            {COMPARISON.eyebrow}
          </span>
          <h2 className="dcv4-balance" style={{ marginTop: 18, fontSize: "clamp(27px,3.4vw,42px)", lineHeight: 1.08, letterSpacing: "-0.035em", fontWeight: 800 }}>
            {COMPARISON.title}
          </h2>
          <p style={{ marginTop: 14, fontSize: "clamp(15.5px,1.45vw,18px)", color: "#475569" }}>{COMPARISON.subtitle}</p>
        </div>

        <div data-reveal="" style={{ marginTop: "clamp(28px,3.6vw,44px)", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 50px -36px rgba(15,23,42,0.4)" }}>
          <div style={{ overflowX: "auto", scrollbarWidth: "thin" }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1.25fr 1fr", background: "#f8fafc", borderBottom: "1px solid #e8edf4" }}>
                <span style={{ padding: "14px 18px" }} />
                <span style={head}>{COMPARISON.columns[0]}</span>
                <span style={head}>{COMPARISON.columns[1]}</span>
                <span style={{ ...head, fontSize: 13.5, fontWeight: 800, color: "#1d4ed8", background: "#eff6ff" }}>{COMPARISON.columns[2]}</span>
              </div>
              {COMPARISON.rows.map((r, i) => (
                <div key={r.label} style={i === COMPARISON.rows.length - 1 ? { ...row, borderBottom: undefined } : row}>
                  <span style={label}>{r.label}</span>
                  <Cell value={r.paper} />
                  <Cell value={r.traditional} />
                  <span style={dc}>✓</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

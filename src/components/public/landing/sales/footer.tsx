import Link from "next/link";
import { FOOTER } from "./v2/landing-data";
import { BrandGlyph } from "../primitives/logo";
import "./v2/landing-v2.css";

/**
 * Footer oscuro de la landing v2 (handoff). Mantiene el export SalesFooter
 * porque también lo montan las páginas de /descubre. Las anclas de producto
 * van con "/#…" para funcionar desde cualquier ruta.
 */
export function SalesFooter() {
  const colTitle = { fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 14 };
  const col = { display: "flex", flexDirection: "column" as const, gap: 10, fontSize: 14 };
  return (
    <footer style={{ background: "#0f172a", color: "#94a3b8", padding: "56px 20px 32px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 40, justifyContent: "space-between", paddingBottom: 36, borderBottom: "1px solid #1e293b" }}>
          <div style={{ maxWidth: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
              <BrandGlyph size={30} mono="#fff" />
              <span style={{ fontFamily: "var(--font-logo, var(--font-sans, system-ui, sans-serif))", fontWeight: 700, fontSize: 18, letterSpacing: "-0.025em", color: "#fff" }}>DaleControl</span>
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>{FOOTER.blurb}</p>
          </div>
          <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
            <div>
              <div style={colTitle}>Producto</div>
              <div style={col}>
                {FOOTER.product.map((l) => (
                  <a key={l.href} href={`/${l.href}`} className="dcv2-footer-link">{l.label}</a>
                ))}
              </div>
            </div>
            <div>
              <div style={colTitle}>Legal</div>
              <div style={col}>
                {FOOTER.legal.map((l) => (
                  <Link key={l.href} href={l.href} className="dcv2-footer-link">{l.label}</Link>
                ))}
              </div>
            </div>
            <div>
              <div style={colTitle}>Contacto</div>
              <div style={col}>
                {FOOTER.contact.map((l) => (
                  <a key={l.label} href={l.href} className="dcv2-footer-link">{l.label}</a>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div style={{ paddingTop: 24, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
          <span>{FOOTER.copyright}</span>
          <span>{FOOTER.madeIn}</span>
        </div>
      </div>
    </footer>
  );
}

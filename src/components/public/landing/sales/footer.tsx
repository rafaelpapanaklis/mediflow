import Link from "next/link";
import { FOOTER, navHref } from "./v2/landing-data";
import { BrandGlyph } from "../primitives/logo";
import "./v2/landing-v2.css";

/**
 * Footer oscuro (diseño v4, fondo #080d1a). Se mantiene el export SalesFooter
 * porque lo montan también blog, /descubre, /casos-de-uso, /herramientas y las
 * 8 páginas de módulo — y con él sus grupos de enlaces:
 *  · Producto  = anclas + Blog + Casos de uso + Herramientas
 *  · Funciones = las 8 páginas de producto por módulo (de producto/data.ts)
 *  · Legal / Contacto
 * Las anclas van con "/#…" para funcionar desde cualquier ruta.
 */
const colTitle = { fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#cbd5e1", textTransform: "uppercase" as const };
const col = { marginTop: 14, display: "flex", flexDirection: "column" as const, gap: 9, fontSize: 14 };

export function SalesFooter() {
  return (
    <footer style={{ background: "#080d1a" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(40px,5vw,64px) 20px 28px", display: "flex", flexWrap: "wrap", gap: "36px 56px" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <BrandGlyph size={24} mono="#a78bfa" />
            <span style={{ fontFamily: "var(--font-logo, var(--font-sans, system-ui, sans-serif))", fontWeight: 800, fontSize: 16, letterSpacing: "-0.025em" }}>
              <span style={{ color: "#a78bfa" }}>Dale</span><span style={{ color: "#ffffff" }}>Control</span>
            </span>
          </span>
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6, color: "#94a3b8", maxWidth: "30ch" }}>{FOOTER.blurb}</p>
        </div>

        <nav aria-label="Producto" style={{ flex: "1 1 150px", minWidth: 0 }}>
          <h3 style={colTitle}>Producto</h3>
          <div style={col}>
            {FOOTER.product.map((l) => (
              <a key={l.href} href={navHref(l.href)} className="dcv2-footer-link">{l.label}</a>
            ))}
          </div>
        </nav>

        <nav aria-label="Funciones" style={{ flex: "1 1 150px", minWidth: 0 }}>
          <h3 style={colTitle}>Funciones</h3>
          <div style={col}>
            {FOOTER.funciones.map((l) => (
              <Link key={l.href} href={l.href} className="dcv2-footer-link">{l.label}</Link>
            ))}
          </div>
        </nav>

        <nav aria-label="Legal" style={{ flex: "1 1 150px", minWidth: 0 }}>
          <h3 style={colTitle}>Legal</h3>
          <div style={col}>
            {FOOTER.legal.map((l) => (
              <Link key={l.href} href={l.href} className="dcv2-footer-link">{l.label}</Link>
            ))}
          </div>
        </nav>

        <nav aria-label="Contacto" style={{ flex: "1 1 150px", minWidth: 0 }}>
          <h3 style={colTitle}>Contacto</h3>
          <div style={col}>
            {FOOTER.contact.map((l) => {
              // Los mailto se quedan en la pestaña; las redes salen del sitio y
              // van con noopener (sin él, la página destino recibe window.opener).
              const external = l.href.startsWith("http");
              return (
                <a
                  key={l.label}
                  href={l.href}
                  className="dcv2-footer-link"
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {l.label}
                </a>
              );
            })}
          </div>
        </nav>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 20px", display: "flex", flexWrap: "wrap", gap: "8px 24px", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{FOOTER.copyright}</span>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{FOOTER.madeIn}</span>
        </div>
      </div>
    </footer>
  );
}

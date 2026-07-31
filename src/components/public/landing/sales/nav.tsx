"use client";

import Link from "next/link";
import { NAV, navHref } from "./v2/landing-data";
import { BrandGlyph, BRAND } from "../primitives/logo";
import "./v2/landing-v2.css";

/**
 * Nav público (diseño v4): sticky con blur, logo de marca, anclas centradas y
 * el grupo de sesión a la derecha.
 *
 * CONSERVA el contrato de siempre — `<SalesNav isLoggedIn>` — porque la
 * detección de sesión vive en nav-session.tsx (client, cookie de Supabase) y
 * porque este mismo nav lo montan blog, /descubre, /casos-de-uso,
 * /herramientas y las 8 páginas de módulo. Por eso las anclas van con "/#…" y
 * se mantiene el acceso "Soy paciente".
 */
export function SalesNav({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const cta = { fontSize: "clamp(13px,1.2vw,15px)", padding: "11px 17px", borderRadius: 10, boxShadow: "0 4px 12px -4px rgba(37,99,235,0.5)", whiteSpace: "nowrap" as const, flex: "0 0 auto" };
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 60, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: "1px solid #e8edf4" }}>
      <div className="dcv4-navbar" style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: "clamp(12px,2vw,28px)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, flex: "0 0 auto", textDecoration: "none", color: "#0f172a" }}>
          <BrandGlyph size={26} />
          <span className="dcv4-brandtext" style={{ fontFamily: "var(--font-logo, var(--font-sans, system-ui, sans-serif))", fontWeight: 800, fontSize: 17.5, letterSpacing: "-0.025em", whiteSpace: "nowrap" }}>
            <span style={{ color: BRAND.morado }}>Dale</span>Control
          </span>
        </Link>
        <nav aria-label="Principal" className="dcv2-nav-anchors" style={{ flex: "1 1 auto", minWidth: 0, display: "flex", justifyContent: "center", gap: "clamp(10px,1.8vw,26px)", whiteSpace: "nowrap" }}>
          {NAV.links.map((l) => (
            <a key={l.href} href={navHref(l.href)} className="dcv2-navlink">{l.label}</a>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", flex: "0 0 auto" }}>
          {isLoggedIn ? (
            <Link href="/dashboard" className="dcv2-btn-primary" style={cta}>Ir al panel</Link>
          ) : (
            <>
              <Link href="/paciente/login" className="dcv2-nav-ghost dcv2-nav-patient" style={{ color: "#64748b" }} title="Portal del paciente">
                Soy paciente
              </Link>
              <Link href="/login" className="dcv2-nav-ghost">{NAV.login}</Link>
              <Link href="/signup" className="dcv2-btn-primary" style={cta}>{NAV.signup}</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

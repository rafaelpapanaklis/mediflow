"use client";

import Link from "next/link";
import { NAV } from "./v2/landing-data";
import { BrandGlyph, BRAND } from "../primitives/logo";
import "./v2/landing-v2.css";

/**
 * Nav de la landing v2 (diseño handoff): sticky con blur, logo de marca
 * (capas apiladas morado→azul, kit "logo 105"),
 * anclas Funciones/Comparativa/Precios/FAQ y sesión a la derecha.
 * Conserva el contrato de siempre: <SalesNav isLoggedIn> — la detección de
 * sesión sigue viviendo en nav-session.tsx (client, cookie de Supabase).
 * También la usan las páginas de /descubre, por eso las anclas van con "/#…"
 * y se conserva el acceso "Soy paciente".
 */
export function SalesNav({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  return (
    <nav aria-label="Principal" style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,.88)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: "1px solid #e8edf5" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 20px", minHeight: 64, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: "#0f172a", padding: "10px 0" }}>
          <BrandGlyph size={30} />
          <span style={{ fontFamily: "var(--font-logo, var(--font-sans, system-ui, sans-serif))", fontWeight: 700, fontSize: 18, letterSpacing: "-0.025em" }}>
            <span style={{ color: BRAND.morado }}>Dale</span>Control
          </span>
        </Link>
        <div className="dcv2-nav-anchors" style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginLeft: "auto" }}>
          {NAV.links.map((l) => (
            <a key={l.href} href={`/${l.href}`} className="dcv2-navlink">{l.label}</a>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          {isLoggedIn ? (
            <Link href="/dashboard" className="dcv2-btn-primary" style={{ fontSize: 14.5, padding: "11px 18px", borderRadius: 10, boxShadow: "0 4px 14px rgba(37,99,235,.28)", whiteSpace: "nowrap" }}>
              Ir al panel
            </Link>
          ) : (
            <>
              <Link href="/paciente/login" className="dcv2-nav-ghost dcv2-nav-patient" style={{ color: "#64748b", fontSize: 13.5 }} title="Portal del paciente">
                Soy paciente
              </Link>
              <Link href="/login" className="dcv2-nav-ghost">{NAV.login}</Link>
              <Link href="/signup" className="dcv2-btn-primary" style={{ fontSize: 14.5, padding: "11px 18px", borderRadius: 10, boxShadow: "0 4px 14px rgba(37,99,235,.28)", whiteSpace: "nowrap" }}>
                {NAV.signup}
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./primitives/logo";
import { SpecialtiesDropdown } from "./specialties-dropdown";

interface HeaderProps {
  // Cuando el visitante ya tiene sesión Supabase activa, el header muestra
  // "Ir al dashboard" en vez de los CTA de login/signup. Lo decide el server
  // component padre (src/app/page.tsx) llamando getSession() — no metemos
  // un fetch client-side para evitar un flash en cada carga.
  isLoggedIn?: boolean;
}

export function Header({ isLoggedIn = false }: HeaderProps) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("ld-theme") : null;
    if (saved === "light" || saved === "dark") setMode(saved);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.querySelector(".landing-theme")?.setAttribute("data-mode", mode);
    try { localStorage.setItem("ld-theme", mode); } catch {}
  }, [mode, mounted]);

  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 100,
      backdropFilter: "blur(16px)",
      background: mode === "dark" ? "rgba(10,10,15,0.7)" : "rgba(255,255,255,0.7)",
      borderBottom: "1px solid var(--ld-border)",
    }}>
      <div style={{
        maxWidth: 1280,
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 48px",
      }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <Logo size={22} color="var(--ld-brand-light)" />
        </Link>

        <div
          className="ld-nav-links"
          style={{
            display: "flex",
            gap: 28,
            fontSize: 13,
            color: "var(--ld-fg-muted)",
            alignItems: "center",
          }}
        >
          <Link href="#features" style={{ color: "inherit", textDecoration: "none" }}>Producto</Link>
          <SpecialtiesDropdown />
          <Link href="#pricing" style={{ color: "inherit", textDecoration: "none" }}>Precios</Link>
          <Link href="#testimonials" style={{ color: "inherit", textDecoration: "none" }}>Clientes</Link>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
          <button
            type="button"
            onClick={() => setMode(m => (m === "dark" ? "light" : "dark"))}
            aria-label={mode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--ld-border)",
              color: "var(--ld-fg)", cursor: "pointer",
              display: "grid", placeItems: "center",
            }}
          >
            {mode === "dark" ? "🌙" : "☀"}
          </button>
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
                color: "#fff",
                fontWeight: 500,
                textDecoration: "none",
                boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
              }}
            >
              Ir al dashboard →
            </Link>
          ) : (
            <>
              <Link href="/login" style={{ color: "var(--ld-fg-muted)", textDecoration: "none" }}>
                Iniciar sesión
              </Link>
              <Link
                href="/signup"
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
                  color: "#fff",
                  fontWeight: 500,
                  textDecoration: "none",
                  boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
                }}
              >
                Prueba gratis →
              </Link>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 768px) {
          .ld-nav-links { display: none !important; }
        }
      `}</style>
    </div>
  );
}

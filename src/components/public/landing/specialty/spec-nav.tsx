"use client";

import Link from "next/link";
import { Logo } from "../primitives/logo";
import { SpecialtiesDropdown } from "../specialties-dropdown";

interface SpecNavProps {
  currentSlug: string;
}

export function SpecNav({ currentSlug }: SpecNavProps) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(16px)",
        background: "rgba(10,10,15,0.7)",
        borderBottom: "1px solid var(--ld-border, var(--border))",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 48px",
        }}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <Logo size={22} color="var(--ld-brand-light, var(--brand-light))" />
        </Link>

        <div
          style={{
            display: "flex",
            gap: 28,
            fontSize: 13,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            alignItems: "center",
          }}
        >
          <Link href="/#features" style={{ cursor: "pointer", color: "inherit", textDecoration: "none" }}>
            Producto
          </Link>
          <SpecialtiesDropdown currentSlug={currentSlug} />
          <Link href="/#pricing" style={{ cursor: "pointer", color: "inherit", textDecoration: "none" }}>
            Precios
          </Link>
          <Link href="/#testimonials" style={{ cursor: "pointer", color: "inherit", textDecoration: "none" }}>
            Clientes
          </Link>
          <Link href="/blog" style={{ cursor: "pointer", color: "inherit", textDecoration: "none" }}>
            Recursos
          </Link>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
          <Link
            href="/login"
            style={{
              color: "var(--ld-fg-muted, var(--fg-muted))",
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
              color: "white",
              fontWeight: 500,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
              textDecoration: "none",
            }}
          >
            Prueba gratis →
          </Link>
        </div>
      </div>
    </div>
  );
}

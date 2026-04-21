"use client";

import Link from "next/link";
import { useState } from "react";
import { getSpecialtiesByCategory } from "@/lib/specialty-data";
import { Logo } from "../primitives/logo";

interface SpecNavProps {
  currentSlug: string;
}

export function SpecNav({ currentSlug }: SpecNavProps) {
  const [open, setOpen] = useState(false);
  const groups = getSpecialtiesByCategory();

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
            position: "relative",
          }}
        >
          <Link
            href="/#features"
            style={{
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            Producto
          </Link>
          <span
            onClick={() => setOpen(!open)}
            style={{
              cursor: "pointer",
              color: "var(--ld-brand-light, var(--brand-light))",
              display: "flex",
              alignItems: "center",
              gap: 4,
              userSelect: "none",
            }}
          >
            Especialidades <span style={{ fontSize: 9 }}>▼</span>
          </span>
          <Link
            href="/#pricing"
            style={{
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            Precios
          </Link>
          <Link
            href="/#testimonials"
            style={{
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            Clientes
          </Link>
          <Link
            href="/blog"
            style={{
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            Recursos
          </Link>

          {open && (
            <div
              onMouseLeave={() => setOpen(false)}
              style={{
                position: "absolute",
                top: 32,
                left: "50%",
                transform: "translateX(-50%)",
                width: 680,
                padding: 20,
                borderRadius: 14,
                background: "rgba(20,20,26,0.96)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(124,58,237,0.25)",
                boxShadow:
                  "0 30px 60px rgba(0,0,0,0.6), 0 0 40px rgba(124,58,237,0.1)",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 20,
              }}
            >
              {Object.entries(groups).map(([cat, items]) => (
                <div key={cat}>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--ld-brand-light, var(--brand-light))",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                      fontFamily:
                        "var(--font-jetbrains-mono, ui-monospace, monospace)",
                    }}
                  >
                    {cat}
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 2 }}
                  >
                    {items.map((s) => {
                      const isActive = s.slug === currentSlug;
                      return (
                        <Link
                          key={s.slug}
                          href={`/${s.slug}`}
                          onClick={() => setOpen(false)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: 6,
                            textDecoration: "none",
                            fontSize: 13,
                            background: isActive
                              ? "rgba(124,58,237,0.18)"
                              : "transparent",
                            color: isActive
                              ? "var(--ld-brand-light, var(--brand-light))"
                              : "var(--ld-fg, var(--fg))",
                          }}
                        >
                          {s.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontSize: 13,
          }}
        >
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

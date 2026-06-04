"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./primitives/logo";
import { SpecialtiesDropdown } from "./specialties-dropdown";

interface HeaderProps {
  // Cuando el visitante ya tiene sesión Supabase activa, el header muestra
  // "Ir al panel" en vez de los CTA de login/signup. Lo decide el server
  // component padre (src/app/page.tsx) — no metemos un fetch client-side para
  // evitar un flash en cada carga.
  isLoggedIn?: boolean;
}

// Enlaces de navegación. Definidos fuera del JSX porque son estáticos.
const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Funciones", href: "#features" },
  { label: "Especialidades", href: "#specialties" },
  { label: "Comparativa", href: "#comparison" },
  { label: "Precios", href: "#pricing" },
];

export function Header({ isLoggedIn = false }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Cerrar el menú móvil con Escape y devolver el foco a la hamburguesa.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        burgerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="lp-header">
      <div className="lp-header__inner">
        {/* Marca */}
        <Link href="/" aria-label="MediFlow — inicio" style={{ textDecoration: "none" }}>
          <Logo size={22} color="var(--ld-brand-strong)" />
        </Link>

        {/* Navegación principal — el CSS global la oculta <860px */}
        <nav className="lp-nav-links" aria-label="Principal">
          <Link href="#features">Funciones</Link>
          <SpecialtiesDropdown />
          <Link href="#comparison">Comparativa</Link>
          <Link href="#pricing">Precios</Link>
        </nav>

        {/* Acciones */}
        <div className="lp-header__actions">
          {isLoggedIn ? (
            <Link href="/dashboard" className="lp-btn lp-btn--primary">
              Ir al panel
            </Link>
          ) : (
            <>
              <Link href="/login" className="lp-btn lp-btn--ghost">
                Iniciar sesión
              </Link>
              <Link href="/signup" className="lp-btn lp-btn--primary">
                Empieza gratis
              </Link>
            </>
          )}

          {/* Hamburguesa — el CSS global la muestra solo <860px */}
          <button
            type="button"
            ref={burgerRef}
            className="lp-burger"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? (
              <X size={22} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Menú móvil — display:none en CSS global; se muestra solo cuando open */}
      {open && (
        <div id="lp-mobile-menu" className="lp-mobile-menu" style={{ display: "flex" }}>
          <nav aria-label="Móvil" className="lp-header-mobile-nav">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={close}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="lp-header-mobile-cta">
            {isLoggedIn ? (
              <Link
                href="/dashboard"
                className="lp-btn lp-btn--primary lp-btn--block"
                onClick={close}
              >
                Ir al panel
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="lp-btn lp-btn--secondary lp-btn--block"
                  onClick={close}
                >
                  Iniciar sesión
                </Link>
                <Link
                  href="/signup"
                  className="lp-btn lp-btn--primary lp-btn--block"
                  onClick={close}
                >
                  Empieza gratis
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        .lp-header-mobile-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .lp-header-mobile-cta {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 14px;
        }
      `}</style>
    </header>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, ArrowRight, UserRound } from "lucide-react";
import { SalesLogo } from "./logo";

const LINKS = [
  { href: "/descubre", label: "Encuentra tu clínica" },
  { href: "/#producto", label: "Producto" },
  { href: "/#funciones", label: "Funciones" },
  { href: "/#precios", label: "Planes" },
  { href: "/#clientes", label: "Clientes" },
];

// Rutas de página (sin ancla) van con <Link>; las de ancla siguen con <a>.
const isPageLink = (href: string) => href.startsWith("/") && !href.includes("#");

export function SalesNav({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Cierra el menú móvil al pasar a desktop.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 881px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header className="mfh-nav" data-scrolled={scrolled}>
      <div className="mfh-container mfh-nav__inner">
        <SalesLogo />

        <nav className="mfh-nav__links" aria-label="Principal">
          {LINKS.map((l) =>
            isPageLink(l.href) ? (
              <Link key={l.href} href={l.href} className="mfh-nav__link">{l.label}</Link>
            ) : (
              <a key={l.href} href={l.href} className="mfh-nav__link">{l.label}</a>
            )
          )}
        </nav>

        <div className="mfh-nav__right">
          {isLoggedIn ? (
            <Link href="/dashboard" className="mfh-btn mfh-btn--primary mfh-nav__signup-desktop">
              Ir al dashboard <ArrowRight />
            </Link>
          ) : (
            <>
              <Link href="/paciente/login" className="mfh-nav__patient" title="Portal del paciente">
                <UserRound aria-hidden /> Soy paciente
              </Link>
              <span className="mfh-nav__sep" aria-hidden />
              <Link href="/login" className="mfh-nav__ghost">Iniciar sesión</Link>
              <Link href="/signup" className="mfh-btn mfh-btn--primary mfh-nav__signup-desktop">
                Crear cuenta
              </Link>
            </>
          )}
          <button
            type="button"
            className="mfh-burger"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <div className="mfh-mobile" data-open={open}>
        <div className="mfh-container mfh-mobile__inner">
          {LINKS.map((l) =>
            isPageLink(l.href) ? (
              <Link key={l.href} href={l.href} className="mfh-mobile__link" onClick={() => setOpen(false)}>{l.label}</Link>
            ) : (
              <a key={l.href} href={l.href} className="mfh-mobile__link" onClick={() => setOpen(false)}>{l.label}</a>
            )
          )}
          <div className="mfh-mobile__cta">
            {isLoggedIn ? (
              <Link href="/dashboard" className="mfh-btn mfh-btn--primary mfh-btn--block" onClick={() => setOpen(false)}>
                Ir al dashboard <ArrowRight />
              </Link>
            ) : (
              <>
                <Link href="/paciente/login" className="mfh-btn mfh-btn--ghost mfh-btn--block" onClick={() => setOpen(false)}>
                  <UserRound size={16} aria-hidden /> Soy paciente
                </Link>
                <div className="mfh-mobile__hint">¿Administras una clínica?</div>
                <Link href="/login" className="mfh-btn mfh-btn--ghost mfh-btn--block" onClick={() => setOpen(false)}>
                  Iniciar sesión
                </Link>
                <Link href="/signup" className="mfh-btn mfh-btn--primary mfh-btn--block" onClick={() => setOpen(false)}>
                  Crear cuenta
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

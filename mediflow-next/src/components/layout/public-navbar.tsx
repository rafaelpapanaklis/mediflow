"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Características", href: "/features" },
  { label: "Precios",         href: "/pricing"  },
  { label: "Especialidades",  href: "/#specialties" },
  { label: "Contacto",        href: "/contact"  },
];

export function PublicNavbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-nav">
      <nav className="container-wide flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 tracking-tight">
          <span className="w-2 h-2 rounded-full bg-brand-600" />
          MediFlow
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-3.5 py-2 rounded-lg text-sm font-medium transition-colors",
                pathname === link.href
                  ? "bg-brand-50 text-brand-700"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/login">Iniciar sesión</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/register">Prueba gratis →</Link>
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-white px-4 py-4 flex flex-col gap-1 shadow-card-md">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-3 border-t border-border flex flex-col gap-2 mt-2">
            <Button variant="outline" className="w-full" asChild>
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button className="w-full" asChild>
              <Link href="/register">Prueba gratis →</Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

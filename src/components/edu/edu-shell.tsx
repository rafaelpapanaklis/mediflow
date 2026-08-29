"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Armchair,
  Banknote,
  Calendar,
  ClipboardList,
  Contact,
  GraduationCap,
  Home,
  Layers,
  LogOut,
  Menu,
  Sun,
  Tags,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import type { EduNavItem, EduNavSection } from "@/lib/edu/types";

/**
 * Chrome del panel de DaleControl Institucional.
 *
 * MÓVIL PRIMERO: el menú es un CAJÓN. Quien usa esto es un docente o un
 * alumno de pie en el piso clínico, con el teléfono en una mano — no un
 * escritorio encogido. En ≥1024 px el mismo <aside> se vuelve columna fija
 * (todo el cambio vive en edu-theme.css, aquí no hay un solo `if` de
 * tamaño).
 *
 * El filtrado por permiso ya se hizo en el layout (server). Este componente
 * SOLO pinta: si decide algo por su cuenta, deja de haber un punto único.
 *
 * `children` llega como slot desde un Server Component, así que las
 * pantallas del panel siguen siendo server y no se arrastran al bundle del
 * navegador por vivir dentro de este cliente.
 */

// Mapa icono-por-nombre: el layout manda items SERIALIZABLES (un string) y
// aquí se resuelve el componente lucide.
// ⚠️ Un nombre que no esté en este mapa cae al fallback EN SILENCIO. Si una
// ola agrega un item con icono nuevo, tiene que agregarlo aquí también.
const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  home: Home,
  users: Users,
  layers: Layers,
  "user-check": UserCheck,
  // Ola 2 — el piso clínico.
  sun: Sun,
  calendar: Calendar,
  contact: Contact,
  chair: Armchair,
  // Ola 5 — tarifarios y caja.
  banknote: Banknote,
  tags: Tags,
  "clipboard-list": ClipboardList,
};

export interface EduShellProps {
  institutionName: string;
  brandName: string;
  brandSub: string;
  userName: string;
  userInitials: string;
  roleLabel: string;
  items: EduNavItem[];
  sectionOrder: EduNavSection[];
  sectionLabels: Record<string, string>;
  children: React.ReactNode;
}

export function EduShell({
  institutionName,
  brandName,
  brandSub,
  userName,
  userInitials,
  roleLabel,
  items,
  sectionOrder,
  sectionLabels,
  children,
}: EduShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Escape cierra el cajón. Sin esto, en un teclado no hay forma de salir
  // del menú sin hacer clic en la cortina.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Con el cajón abierto, el fondo NO se desplaza (si no, el dedo arrastra
  // la página de atrás y el menú parece pegado).
  useEffect(() => {
    if (!open) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [open]);

  /**
   * Se enciende UN item: el que COINCIDE MÁS.
   *
   * 🔴 Con la regla ingenua (`empieza por el href`), estar en
   * /instituto/padron/estructura encendía "Padrón" Y "Programas y
   * generaciones" a la vez, porque el href del primero es prefijo del
   * segundo. Dos items activos no es un detalle estético: le dice a la
   * persona que está en dos sitios. Gana el href más largo que coincide.
   */
  const activeKey = (() => {
    if (!pathname) return null;
    let mejor: { key: string; largo: number } | null = null;
    for (const item of items) {
      if (pathname !== item.href && !pathname.startsWith(item.href + "/")) continue;
      if (!mejor || item.href.length > mejor.largo) mejor = { key: item.key, largo: item.href.length };
    }
    return mejor?.key ?? null;
  })();

  async function handleLogout() {
    if (leaving) return;
    setLeaving(true);
    try {
      await fetch("/api/instituto/auth/logout", { method: "POST" });
    } catch {
      // Aunque el POST falle, sacamos a la persona de la pantalla: el
      // destino es el login del vertical, que sin sesión válida no deja
      // pasar de todos modos.
    } finally {
      // Navegación dura: garantiza un único montaje del layout del panel.
      window.location.href = "/instituto/login";
    }
  }

  // Las secciones sin items no se pintan: un encabezado "Académico" vacío
  // le dice a un alumno que le falta algo que en realidad no existe.
  const sections = sectionOrder
    .map((section) => ({
      section,
      label: sectionLabels[section] ?? section,
      items: items.filter((i) => i.section === section),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="edu-shell">
      {open && (
        <button
          type="button"
          className="edu-scrim"
          onClick={() => setOpen(false)}
          aria-label="Cerrar menú"
        />
      )}

      <aside
        id="edu-menu"
        className="edu-sidebar"
        data-open={open ? "true" : "false"}
        aria-label="Menú del instituto"
      >
        <div className="edu-sidebar__brand">
          <div className="edu-sidebar__logo" aria-hidden="true">
            <GraduationCap size={19} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="edu-sidebar__brandname">{brandName}</div>
            <div className="edu-sidebar__brandsub">{brandSub}</div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="edu-iconbtn edu-only-mobile"
            aria-label="Cerrar menú"
          >
            <X size={17} />
          </button>
        </div>

        <div
          style={{
            padding: "0 8px 10px",
            fontSize: 13,
            fontWeight: 650,
            color: "var(--edu-text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={institutionName}
        >
          {institutionName}
        </div>

        <nav className="edu-nav" aria-label="Secciones">
          {sections.map((s) => (
            <div key={s.section}>
              <div className="edu-nav__section">{s.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {s.items.map((item) => {
                  const active = item.key === activeKey;
                  const Icon = ICONS[item.icon] ?? Home;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`edu-nav__item ${active ? "edu-nav__item--active" : ""}`}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="edu-sidebar__foot">
          <div className="edu-whoami">
            <div className="edu-whoami__avatar" aria-hidden="true">
              {userInitials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="edu-whoami__name" title={userName}>
                {userName}
              </div>
              <div className="edu-whoami__role">{roleLabel}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={leaving}
            className="edu-btn edu-btn--danger"
          >
            <LogOut size={17} />
            <span>{leaving ? "Cerrando sesión…" : "Cerrar sesión"}</span>
          </button>
        </div>
      </aside>

      <div className="edu-body">
        <header className="edu-topbar">
          <button
            type="button"
            className="edu-iconbtn"
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={open}
            aria-controls="edu-menu"
          >
            <Menu size={18} />
          </button>
          <div className="edu-topbar__title">
            <span className="edu-topbar__sub">{brandSub}</span>
            <span className="edu-topbar__name" title={institutionName}>
              {institutionName}
            </span>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="edu-main">
          {children}
        </main>
      </div>
    </div>
  );
}

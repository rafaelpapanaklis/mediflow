"use client";

// Shell del panel del paciente. Implementa A10.
// · Nav con 5 secciones: Inicio (/paciente), Citas (/paciente/citas),
//   Historial (/paciente/historial), Pagos (/paciente/pagos), Perfil
//   (/paciente/perfil) + botón "Cerrar sesión" (POST /api/paciente/logout →
//   window.location.href = "/paciente/login").
// · RESPONSIVE OBLIGATORIO a cada resolución: desktop = sidebar compacta o
//   topbar; móvil = bottom-nav o menú hamburguesa. NADA de anchos fijos que
//   corten con scroll horizontal. Usa clamp() como el panel de laboratorios.
// · Estilo: dark (#0b0815/#121020, var(--text-1)), acento violeta
//   #8b5cf6/#7c3aed, IBM Plex ya viene del root layout (font-sans).
//   Referencia: src/components/laboratorios/lab-sidebar.tsx + lab-topbar.tsx.
// · Marca: "DaleControl · Portal del paciente". Español neutro con tú.
// · usePathname() para marcar la sección activa.
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Calendar,
  FileText,
  CreditCard,
  FolderOpen,
  MessageSquare,
  User,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/public/landing/primitives/logo";
import { NotifBell } from "@/components/paciente/notif-bell";
import type { PacienteMe } from "@/lib/patient-portal/types";

export interface PacientePortalShellProps {
  me: PacienteMe;
  children: React.ReactNode;
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
  /** Solo /paciente se marca con match exacto; el resto con startsWith. */
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/paciente", label: "Inicio", icon: Home, exact: true },
  { href: "/paciente/citas", label: "Citas", icon: Calendar },
  { href: "/paciente/inbox", label: "Mensajes", icon: MessageSquare },
  { href: "/paciente/historial", label: "Historial", icon: FileText },
  { href: "/paciente/pagos", label: "Pagos", icon: CreditCard },
  { href: "/paciente/documentos", label: "Documentos", icon: FolderOpen },
  { href: "/paciente/perfil", label: "Perfil", icon: User },
];

const BORDER_SOFT = "1px solid rgba(255,255,255,0.08)";

async function handleLogout() {
  try {
    await fetch("/api/paciente/logout", { method: "POST" });
  } finally {
    window.location.assign("/paciente/login");
  }
}

export function PacientePortalShell({ me, children }: PacientePortalShellProps) {
  const pathname = usePathname();

  function isActive(item: NavItem) {
    if (!pathname) return false;
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  const firstName = (me.name || "").trim().split(/\s+/)[0] || "Paciente";

  return (
    <div
      className="flex min-h-screen font-sans"
      style={{ background: "#0b0815", color: "#f5f5f7" }}
    >
      {/* ── Sidebar desktop (≥1024px) ─────────────────────────────────── */}
      <aside
        className="hidden lg:flex"
        style={{
          width: 240,
          flexShrink: 0,
          flexDirection: "column",
          gap: 4,
          padding: "16px 12px",
          borderRight: BORDER_SOFT,
          background: "rgba(255,255,255,0.02)",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        {/* Marca */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px 16px",
            borderBottom: BORDER_SOFT,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
              boxShadow: "0 0 18px rgba(124,58,237,0.35)",
            }}
          >
            <Logo size={17} showText={false} color="#fff" />
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "#f5f5f7",
              }}
            >
              DaleControl
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(245,245,247,0.55)",
                letterSpacing: "0.02em",
              }}
            >
              Portal del paciente
            </span>
          </span>
        </div>

        {/* Nav vertical */}
        <nav
          aria-label="Secciones del portal"
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "bg-[rgba(124,58,237,0.15)] text-[#a78bfa]"
                    : "text-[rgba(245,245,247,0.62)] transition-colors hover:bg-white/[0.05] hover:text-[#f5f5f7]"
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  fontSize: 13.5,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {/* Notificaciones: item extra con campana + badge de no leídas.
              Fuera de NAV_ITEMS para no agregarlo al bottom-nav (clamp 320px). */}
          <NotifBell variant="sidebar" />
        </nav>

        {/* Paciente + cerrar sesión */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 12,
            borderTop: BORDER_SOFT,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ padding: "0 10px", minWidth: 0 }}>
            <div
              title={me.name}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#f5f5f7",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {me.name}
            </div>
            <div
              title={me.email}
              style={{
                fontSize: 11,
                color: "rgba(245,245,247,0.5)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {me.email}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="transition-colors hover:bg-white/[0.05]"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 500,
              color: "rgba(248,113,113,0.85)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              width: "100%",
            }}
          >
            <LogOut size={16} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Topbar móvil (<1024px) ────────────────────────────────────── */}
      <header
        className="flex lg:hidden"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          zIndex: 30,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "0 14px",
          background: "rgba(11,8,21,0.92)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: BORDER_SOFT,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
            }}
          >
            <Logo size={15} showText={false} color="#fff" />
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "#f5f5f7",
                lineHeight: 1.2,
              }}
            >
              DaleControl
            </span>
            <span
              style={{
                display: "block",
                fontSize: 10.5,
                color: "rgba(245,245,247,0.55)",
                lineHeight: 1.2,
              }}
            >
              Portal del paciente
            </span>
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            title={me.name}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "rgba(245,245,247,0.85)",
              maxWidth: 130,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {firstName}
          </span>
          {/* Campana móvil: en el topbar (NO en el bottom-nav) para no romper
              el clamp de 320px del bottom-nav de 6 ítems. */}
          <NotifBell variant="topbar" />
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Cerrar sesión"
            className="transition-colors hover:bg-white/[0.05]"
            style={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              color: "rgba(248,113,113,0.85)",
              background: "transparent",
              border: BORDER_SOFT,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <LogOut size={15} />
          </button>
        </span>
      </header>

      {/* ── Bottom-nav móvil (<1024px) ────────────────────────────────── */}
      <nav
        className="grid lg:hidden"
        aria-label="Secciones del portal"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          gridTemplateColumns: `repeat(${NAV_ITEMS.length}, 1fr)`,
          background: "rgba(11,8,21,0.96)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderTop: BORDER_SOFT,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={active ? "text-[#a78bfa]" : "text-[rgba(245,245,247,0.6)]"}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "8px 1px 7px",
                minWidth: 0,
                // 7 items: el label más largo ("Documentos", 10 caracteres) debe
                // caber en pantallas de 320px (≈45px por columna). Bajamos el
                // mínimo del clamp a 8px y, como red de seguridad, el span
                // elipsiza antes de pisar al vecino.
                fontSize: "clamp(8px, 2.2vw, 10.5px)",
                fontWeight: 500,
                textDecoration: "none",
                background: active ? "rgba(124,58,237,0.15)" : "transparent",
              }}
            >
              <Icon size={19} />
              <span
                style={{
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Contenido ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col" style={{ minWidth: 0 }}>
        <main
          id="main-content"
          tabIndex={-1}
          className="pt-[72px] pb-[88px] lg:pt-[clamp(12px,2vw,28px)] lg:pb-[clamp(12px,2vw,28px)]"
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
            minWidth: 0,
            paddingLeft: "clamp(12px, 2vw, 28px)",
            paddingRight: "clamp(12px, 2vw, 28px)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

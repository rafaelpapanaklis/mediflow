"use client";

// Campana del centro de notificaciones (shell del portal). Poll de no leídas
// (20s + revalidate on focus vía usePacienteData) con badge. Dos variantes:
// "sidebar" (desktop, con label) y "topbar" (móvil, solo icono). NO se agrega al
// bottom-nav para no romper el clamp de 320px (el bottom-nav queda en 6 ítems).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";

const HREF = "/paciente/notificaciones";

function useUnread(): number {
  const { data } = usePacienteData<{ count: number }>(
    "/api/paciente/notificaciones/unread-count",
  );
  const n = data?.count ?? 0;
  return n > 0 ? n : 0;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: -5,
        right: -5,
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 999,
        background: "#f43f5e",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: "16px",
        textAlign: "center",
        boxSizing: "border-box",
        boxShadow: "0 0 0 2px #0b0815",
      }}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function NotifBell({ variant }: { variant: "sidebar" | "topbar" }) {
  const pathname = usePathname();
  const count = useUnread();
  const active = pathname === HREF || (pathname?.startsWith(HREF + "/") ?? false);
  const label =
    count > 0 ? `Notificaciones (${count} sin leer)` : "Notificaciones";

  if (variant === "topbar") {
    return (
      <Link
        href={HREF}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className="transition-colors hover:bg-white/[0.05]"
        style={{
          position: "relative",
          display: "grid",
          placeItems: "center",
          width: 32,
          height: 32,
          borderRadius: 8,
          color: active ? "#a78bfa" : "rgba(245,245,247,0.85)",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
          textDecoration: "none",
        }}
      >
        <Bell size={15} />
        <Badge count={count} />
      </Link>
    );
  }

  // Variante sidebar (desktop): item de nav con label, igual que NAV_ITEMS.
  return (
    <Link
      href={HREF}
      aria-current={active ? "page" : undefined}
      aria-label={label}
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
      <span style={{ position: "relative", display: "grid", placeItems: "center" }}>
        <Bell size={16} />
        <Badge count={count} />
      </span>
      <span>Notificaciones</span>
    </Link>
  );
}

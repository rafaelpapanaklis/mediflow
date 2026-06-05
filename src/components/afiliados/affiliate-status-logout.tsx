"use client";

import { LogOut } from "lucide-react";

export function AffiliateStatusLogout() {
  async function handleLogout() {
    try {
      await fetch("/api/afiliados/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/afiliados/login";
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 16px",
        marginTop: 4,
        borderRadius: 9,
        background: "transparent",
        border: "1px solid var(--border-soft)",
        color: "var(--text-2)",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
      }}
    >
      <LogOut size={15} />
      Cerrar sesión
    </button>
  );
}

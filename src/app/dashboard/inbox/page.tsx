export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Construction } from "lucide-react";

export const metadata: Metadata = { title: "Inbox — MediFlow" };

export default function InboxPage() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "60px auto",
        padding: "32px",
        textAlign: "center",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
          display: "grid",
          placeItems: "center",
          margin: "0 auto 18px",
          color: "#fff",
          boxShadow: "0 8px 24px -8px rgba(124,58,237,0.5)",
        }}
      >
        <Inbox size={32} aria-hidden />
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
        Inbox unificado
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--text-2)",
          lineHeight: 1.55,
          marginBottom: 24,
          maxWidth: 520,
          marginInline: "auto",
        }}
      >
        Todos los mensajes de tus pacientes en un solo lugar: WhatsApp,
        email, formularios del portal, validaciones de citas y recordatorios
        del staff. La UI llegará pronto.
      </p>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          fontSize: 12,
          fontWeight: 600,
          color: "#b45309",
          background: "rgba(245, 158, 11, 0.10)",
          border: "1px solid rgba(245, 158, 11, 0.4)",
          borderRadius: 999,
        }}
      >
        <Construction size={13} aria-hidden /> En construcción · backend listo, UI próximamente
      </div>
      <div style={{ marginTop: 28 }}>
        <Link
          href="/dashboard/settings/integrations"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--brand, #7c3aed)",
            textDecoration: "none",
          }}
        >
          → Configurar integraciones (WhatsApp, Email)
        </Link>
      </div>
    </div>
  );
}

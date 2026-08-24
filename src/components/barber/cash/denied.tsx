import Link from "next/link";
import { Lock, ShieldOff } from "lucide-react";

/**
 * Tarjeta de "sin acceso" del dinero barber (server-safe). Dos casos:
 *  · kind="permission": el rol no tiene el permiso de la página.
 *  · kind="plan": el plan de la barbería no incluye la feature.
 * El gate REAL está en el servidor (página + API); esto solo explica.
 */
export function BarberDenied({
  kind,
  title,
  body,
  ctaLabel,
}: {
  kind: "permission" | "plan";
  title: string;
  body: string;
  ctaLabel?: string;
}) {
  const Icon = kind === "plan" ? Lock : ShieldOff;
  return (
    <div style={{ minHeight: "50vh", display: "grid", placeItems: "center", padding: "clamp(16px, 3vw, 40px)" }}>
      <div
        className="shadow-card"
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 36px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "var(--brand-soft)",
            color: "var(--brand)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon size={24} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>{title}</h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>{body}</p>
        {kind === "plan" && ctaLabel && (
          <Link href="/barber/suscripcion" className="btn-new barber-btn-primary" style={{ marginTop: 4 }}>
            {ctaLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

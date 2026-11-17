import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * Tarjeta de «no encontrado» del panel de barber (server-safe, sin datos).
 *
 * La pinta src/app/barber/(panel)/not-found.tsx cada vez que una página del
 * panel llama a notFound(): un recibo, un ticket, un corte o un cliente que
 * no existe O que no es de quien lo pide. Las dos cosas se ven IGUAL a
 * propósito: no se dice si lo que se buscó existe.
 *
 * Mismo molde que BarberDenied (cash/denied.tsx): tokens del rediseño, nada
 * del dental. El enlace vuelve a Inicio del panel, no a la raíz del sitio.
 */
export function BarberPanelNotFound({ title, body, cta }: { title: string; body: string; cta: string }) {
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
          <SearchX size={24} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>{title}</h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>{body}</p>
        <Link href="/barber/inicio" className="btn-new barber-btn-primary" style={{ marginTop: 4 }}>
          {cta}
        </Link>
      </div>
    </div>
  );
}

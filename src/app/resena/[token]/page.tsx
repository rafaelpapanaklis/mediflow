import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Link2Off, CheckCircle2 } from "lucide-react";
import { getInviteView } from "@/lib/reviews/service";
import { ResenaForm } from "./ResenaForm";

// Página pública tokenizada para dejar una reseña. NOINDEX (privada, un solo uso).
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Deja tu reseña — DaleControl",
  robots: { index: false, follow: false },
};

export default async function ResenaPage({ params }: { params: { token: string } }) {
  const view = await getInviteView(params.token);
  const theme = view.themeColor || "#7c3aed";
  const initial = view.clinicName.trim().charAt(0).toUpperCase() || "C";

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(180deg, #f5f3ff, #faf8ff)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#fff",
          border: "1px solid #e9e7f3",
          borderRadius: 24,
          padding: "28px 24px 26px",
          boxShadow: "0 16px 48px -16px rgba(15,23,42,0.22)",
        }}
      >
        {/* Encabezado: logo + nombre */}
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          {view.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={view.logoUrl}
              alt=""
              style={{ width: 56, height: 56, borderRadius: 16, objectFit: "cover", margin: "0 auto 10px", display: "block" }}
            />
          ) : (
            <div
              style={{
                width: 56, height: 56, borderRadius: 16, margin: "0 auto 10px",
                display: "grid", placeItems: "center", background: theme, color: "#fff", fontSize: 22, fontWeight: 800,
              }}
              aria-hidden="true"
            >
              {initial}
            </div>
          )}
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" }}>
            {view.clinicName}
          </div>
        </div>

        {view.state === "ok" ? (
          <ResenaForm token={params.token} clinicName={view.clinicName} themeColor={theme} />
        ) : (
          <StateMessage state={view.state} clinicSlug={view.clinicSlug} theme={theme} />
        )}
      </div>
    </main>
  );
}

function StateMessage({
  state,
  clinicSlug,
  theme,
}: {
  state: "submitted" | "expired" | "invalid";
  clinicSlug: string;
  theme: string;
}) {
  const content = {
    submitted: {
      icon: <CheckCircle2 size={28} />,
      title: "Ya dejaste tu reseña",
      body: "¡Gracias! Solo se permite una reseña por cita. Tu opinión ya fue registrada.",
    },
    expired: {
      icon: <Clock size={28} />,
      title: "El enlace expiró",
      body: "Este enlace para dejar tu reseña ya no está disponible (vence a los 30 días).",
    },
    invalid: {
      icon: <Link2Off size={28} />,
      title: "Enlace no válido",
      body: "No encontramos esta reseña. Revisa que hayas abierto el enlace completo que te enviamos.",
    },
  }[state];

  return (
    <div style={{ textAlign: "center", padding: "8px 0" }}>
      <div
        style={{
          margin: "0 auto 16px", width: 64, height: 64, borderRadius: "50%",
          display: "grid", placeItems: "center", background: `${theme}14`, color: theme,
        }}
      >
        {content.icon}
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{content.title}</h2>
      <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.55, maxWidth: 340, margin: "0 auto 20px" }}>
        {content.body}
      </p>
      {clinicSlug && (
        <Link
          href={`/descubre/clinica/${clinicSlug}`}
          style={{
            display: "inline-block", padding: "11px 22px", borderRadius: 12, background: theme,
            color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none",
          }}
        >
          Ver perfil de la clínica
        </Link>
      )}
    </div>
  );
}

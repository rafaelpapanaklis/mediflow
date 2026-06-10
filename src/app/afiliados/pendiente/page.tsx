export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { Logo } from "@/components/public/landing/primitives/logo";
import { AffiliateStatusLogout } from "@/components/afiliados/affiliate-status-logout";

type StatusCopy = {
  title: string;
  body: string;
  tone: "neutral" | "danger";
};

export default async function AffiliatePendingPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");
  if (ctx.status === "APPROVED") redirect("/afiliados/inicio");

  let copy: StatusCopy;
  if (ctx.status === "REJECTED") {
    copy = {
      title: "Tu solicitud fue rechazada",
      body:
        "El equipo de DaleControl revisó tu solicitud y no pudo aprobarla en este momento. Si crees que se trata de un error, ponte en contacto con nuestro equipo.",
      tone: "danger",
    };
  } else if (ctx.status === "SUSPENDED") {
    copy = {
      title: "Tu cuenta está suspendida",
      body:
        "El acceso de tu cuenta de afiliado ha sido suspendido. Contacta al equipo de DaleControl para más información sobre cómo restablecerlo.",
      tone: "danger",
    };
  } else {
    copy = {
      title: "Tu registro está en revisión",
      body:
        "El equipo de DaleControl revisará tu solicitud y recibirás acceso al panel de afiliados en cuanto sea aprobada. Te notificaremos por correo cuando esté lista.",
      tone: "neutral",
    };
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "clamp(16px, 4vw, 48px)",
        background:
          "radial-gradient(120% 120% at 50% 0%, var(--bg-hover) 0%, var(--bg-elev) 60%)",
        color: "var(--text-1)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <div
        className="shadow-card"
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 36px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
            display: "grid",
            placeItems: "center",
            boxShadow:
              "0 0 24px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          <Logo size={26} showText={false} color="#fff" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--text-1)",
              margin: 0,
            }}
          >
            {copy.title}
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--text-2)",
              margin: 0,
            }}
          >
            {copy.body}
          </p>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid var(--border-soft)",
            color: copy.tone === "danger" ? "var(--danger)" : "var(--text-3)",
            background: "var(--bg-hover)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background:
                copy.tone === "danger" ? "var(--danger)" : "var(--brand)",
              boxShadow:
                copy.tone === "danger"
                  ? "0 0 8px var(--danger)"
                  : "0 0 8px var(--brand)",
            }}
          />
          {ctx.affiliate.name}
        </div>

        <AffiliateStatusLogout />
      </div>
    </main>
  );
}

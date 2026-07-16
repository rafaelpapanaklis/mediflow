export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { ReportesClient } from "@/components/afiliados/reportes-client";

/**
 * /afiliados/reportes — export Excel (referidos/comisiones por rango) y
 * estado de cuenta mensual en PDF.
 */
export default async function AffiliateReportsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Hero compacto (mismo idioma visual que inicio/page.tsx) */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 280,
            height: 180,
            pointerEvents: "none",
            background: "radial-gradient(60% 70% at 20% 30%, rgba(124,58,237,0.18), transparent 70%)",
          }}
        />
        <div
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "var(--brand-grad)",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <FileText size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Reportes
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Exporta tus referidos y comisiones, y descarga tu estado de cuenta mensual.
          </p>
        </div>
      </div>

      <ReportesClient />
    </div>
  );
}

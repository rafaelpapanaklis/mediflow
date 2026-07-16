export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { EstadisticasClient } from "@/components/afiliados/estadisticas-client";

/**
 * /afiliados/estadisticas — funnel, serie temporal, desglose por ref y
 * bloque de comisiones del afiliado autenticado. La data la trae el
 * cliente de /api/afiliados/stats.
 */
export default async function AffiliateStatsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Hero */}
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
          <BarChart3 size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Estadísticas
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Tu funnel de referidos, actividad y comisiones en un solo lugar.
          </p>
        </div>
      </div>

      <EstadisticasClient />
    </div>
  );
}

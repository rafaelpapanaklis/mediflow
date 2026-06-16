// Métricas del módulo Marketing (WS-MKT-T6) — PLACEHOLDER HONESTO.
// No inventa números: las métricas reales (alcance, likes, comentarios) llegan
// vía Meta Insights API cuando la clínica conecte Instagram/Facebook. El layout
// ya está listo para enchufar recharts en el panel inferior.

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Eye, Heart, UserPlus, Send, Link2 } from "lucide-react";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";

export const metadata: Metadata = { title: "Métricas — Marketing — DaleControl" };

const SOON = "Próximamente";

export default function MarketingInsightsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)", maxWidth: 640 }}>
        Aquí verás el rendimiento de tus publicaciones —alcance, interacciones y nuevos seguidores—
        directo de Instagram y Facebook. Conecta tus redes para empezar a medir.
      </p>

      {/* KPIs en estado "próximamente" (sin datos inventados) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        <AnalyticsCard label="Alcance" value="—" hint={SOON} tone="neutral" icon={<Eye size={14} aria-hidden />} />
        <AnalyticsCard label="Interacciones" value="—" hint={SOON} tone="neutral" icon={<Heart size={14} aria-hidden />} />
        <AnalyticsCard label="Nuevos seguidores" value="—" hint={SOON} tone="neutral" icon={<UserPlus size={14} aria-hidden />} />
        <AnalyticsCard label="Publicaciones" value="—" hint={SOON} tone="neutral" icon={<Send size={14} aria-hidden />} />
      </div>

      {/* Panel de gráfica — listo para recharts cuando haya datos de Meta Insights */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(28px, 5vw, 56px) 24px",
          minHeight: 300,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 14,
        }}
      >
        {/* Barras fantasma decorativas (sin valores) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "auto 0 0 0",
            height: "55%",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: "2.2%",
            padding: "0 6%",
            opacity: 0.07,
            pointerEvents: "none",
          }}
        >
          {GHOST_BARS.map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                maxWidth: 46,
                borderRadius: "6px 6px 0 0",
                background: "var(--brand)",
              }}
            />
          ))}
        </div>

        {/* Mensaje + CTA (por encima de las barras) */}
        <div
          style={{
            position: "relative",
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--brand-softer)",
            border: "1px solid rgba(124,58,237,0.20)",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 0 24px rgba(124,58,237,0.08)",
          }}
        >
          <BarChart3 size={26} aria-hidden style={{ color: "var(--brand)" }} />
        </div>
        <h2 style={{ margin: 0, fontSize: "clamp(15px, 1vw, 17px)", fontWeight: 600, color: "var(--text-1)", position: "relative" }}>
          Las métricas llegan pronto
        </h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-2)", maxWidth: 420, position: "relative" }}>
          Cuando conectes Instagram y Facebook y se habilite Meta Insights, aquí verás el alcance, los
          likes y los comentarios de cada publicación, con gráficas de evolución.
        </p>
        <Link
          href="/dashboard/marketing/connections"
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 34,
            padding: "0 14px",
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            background: "var(--brand)",
            color: "#fff",
            boxShadow: "0 0 0 1px rgba(124,58,237,0.4), 0 4px 16px -4px rgba(124,58,237,0.5)",
          }}
        >
          <Link2 size={15} aria-hidden />
          Conectar redes
        </Link>

        {/*
          TODO(T-insights / siguiente ola): reemplazar las barras fantasma por
          <ResponsiveContainer><BarChart data={metrics}>…</BarChart></ResponsiveContainer>
          alimentado por GET /api/marketing/insights (Meta Graph Insights API).
        */}
      </section>
    </div>
  );
}

// Alturas relativas de las barras fantasma (decorativas, NO son datos reales).
const GHOST_BARS = [38, 54, 47, 66, 58, 72, 63, 80, 70, 88, 76, 92];

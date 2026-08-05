export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { getAccountManagerForAffiliate } from "@/lib/account-manager/get-for-affiliate";
import { isOnline, formatSchedule, nextAvailableText } from "@/lib/account-manager/availability";
import { SoporteAfiliadoClient } from "./soporte-client";

export const metadata: Metadata = { title: "Soporte — Afiliados DaleControl" };

/**
 * /afiliados/soporte — manager de cuenta + tickets del afiliado.
 *
 * El manager y su disponibilidad se resuelven en el SERVIDOR: "en línea" se
 * evalúa en la timezone del MANAGER (no en la del navegador) y al cliente solo
 * viaja el manager ASIGNADO a este afiliado, nunca el catálogo.
 *
 * getAccountManagerForAffiliate nunca lanza: si la columna aún no existe
 * devuelve null y la tarjeta cae al canal general de soporte.
 */
export default async function AffiliateSupportPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const manager = await getAccountManagerForAffiliate(ctx.affiliateId);
  const now = new Date();
  const online = manager ? isOnline(manager, now) : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Hero compacto (mismo idioma visual que inicio/reportes). */}
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
          <LifeBuoy size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Soporte
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Escríbele a tu manager por WhatsApp o abre un ticket: comisiones, pagos,
            material de venta o cualquier duda de tu cuenta.
          </p>
        </div>
      </div>

      <SoporteAfiliadoClient
        manager={manager}
        online={online}
        scheduleText={manager ? formatSchedule(manager) : ""}
        nextAvailable={manager && !online ? nextAvailableText(manager, now) : ""}
        affiliateName={ctx.affiliate.name}
        referralCode={ctx.affiliate.referralCode}
      />
    </div>
  );
}

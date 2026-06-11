export const dynamic = "force-dynamic";

// Herramientas del VENDEDOR: multi-links con campaña + cupón propio. El cliente
// (<SellerTools/>) carga sus datos contra /api/afiliados/vendedor/*; aquí solo
// pasamos el slug del afiliado padre para construir su URL base /socio/<slug>.
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { SellerTools } from "@/components/afiliados/seller-tools";

export default async function VendedorHerramientasPage() {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Megaphone size={22} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Herramientas de venta
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Links por campaña y tu cupón para traer más clínicas a tu equipo.
          </p>
        </div>
      </div>

      <SellerTools
        siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com"}
        parentSlug={ctx.parentSlug}
      />
    </div>
  );
}

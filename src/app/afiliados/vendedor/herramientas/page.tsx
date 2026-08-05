export const dynamic = "force-dynamic";

// Herramientas del VENDEDOR: multi-links con campaña + cupón propio. El cliente
// (<SellerTools/>) carga sus datos contra /api/afiliados/vendedor/*; aquí solo
// pasamos el slug del afiliado padre para construir su URL base /socio/<slug>.
import { redirect } from "next/navigation";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { SellerTools } from "@/components/afiliados/seller-tools";
import { PageHead } from "@/components/afiliados/ui/panel-ui";

export default async function VendedorHerramientasPage() {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <>
      <PageHead
        title="Herramientas de venta"
        sub="Links por campaña y tu cupón para traer más clínicas a tu equipo."
      />

      <SellerTools
        siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com"}
        parentSlug={ctx.parentSlug}
      />
    </>
  );
}

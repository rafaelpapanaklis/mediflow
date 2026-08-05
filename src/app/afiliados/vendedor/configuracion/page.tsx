export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { SellerPayoutForm } from "@/components/afiliados/seller-payout-form";
import { PageHead } from "@/components/afiliados/ui/panel-ui";

export default async function VendedorConfiguracionPage() {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720, minWidth: 0 }}>
      <PageHead title="Datos de pago" sub="Configura cómo quieres recibir tus comisiones." />

      <SellerPayoutForm
        initialMethod={ctx.seller.payoutMethod ?? ""}
        initialDetails={ctx.seller.payoutDetails ?? ""}
      />
    </div>
  );
}

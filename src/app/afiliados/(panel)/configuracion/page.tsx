export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { PayoutForm } from "@/components/afiliados/payout-form";

export default async function AffiliateSettingsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
      <div>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Datos de pago
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Configura cómo quieres recibir tus comisiones.
        </p>
      </div>

      <PayoutForm
        initialMethod={ctx.affiliate.payoutMethod ?? ""}
        initialDetails={ctx.affiliate.payoutDetails ?? ""}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { loadPartnerPage, toPageState } from "@/lib/affiliates/page-store";
import { EmptyState, PageHead } from "@/components/afiliados/ui/panel-ui";
import { MiPaginaClient } from "@/components/afiliados/mi-pagina-client";

/**
 * "Mi página" — el socio personaliza su /socio/<slug>.
 *
 * Del contexto solo bajan `name` y `slug`. La fila de `affiliates` que trae la
 * sesión lleva correo, datos de pago y porcentaje de comisión; pasarla entera
 * a un componente cliente los mandaría al navegador sin necesidad ninguna.
 */
export default async function MiPaginaPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const row = await loadPartnerPage(ctx.affiliateId);

  if (!row) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860 }}>
        <PageHead title="Mi página" />
        <EmptyState icon={null} title="No pudimos cargar tu página">
          Vuelve a intentarlo en un momento. Si sigue igual, escríbenos desde Soporte.
        </EmptyState>
      </div>
    );
  }

  return (
    <MiPaginaClient
      name={ctx.affiliate.name}
      slug={ctx.affiliate.slug}
      initialState={toPageState(row)}
    />
  );
}

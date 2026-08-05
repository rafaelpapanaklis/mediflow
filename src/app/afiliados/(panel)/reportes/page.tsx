export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { PageHead } from "@/components/afiliados/ui/panel-ui";
import { ReportesClient } from "@/components/afiliados/reportes-client";

/**
 * /afiliados/reportes — export Excel (referidos/comisiones por rango) y
 * estado de cuenta mensual en PDF.
 *
 * Sin envoltorio propio: `.dcafp-main` ya separa encabezado y contenido.
 */
export default async function AffiliateReportsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <>
      <PageHead
        title="Reportes"
        sub="Exporta tus referidos y comisiones, y descarga tu estado de cuenta mensual."
      />
      <ReportesClient />
    </>
  );
}

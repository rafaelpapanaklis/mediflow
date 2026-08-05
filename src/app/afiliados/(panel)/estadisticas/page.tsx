export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { PageHead } from "@/components/afiliados/ui/panel-ui";
import { EstadisticasClient } from "@/components/afiliados/estadisticas-client";

/**
 * /afiliados/estadisticas — funnel, serie temporal, desglose por ref y
 * bloque de comisiones del afiliado autenticado. La data la trae el
 * cliente de /api/afiliados/stats.
 *
 * Sin envoltorio propio: `.dcafp-main` ya es una columna flex con gap, así
 * que el encabezado y el cliente se separan solos. Un div extra rompería el
 * `@container` de las rejillas de abajo si algún día llevara padding.
 */
export default async function AffiliateStatsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  return (
    <>
      <PageHead
        title="Estadísticas"
        sub="Tu funnel de referidos, actividad y comisiones en un solo lugar."
      />
      <EstadisticasClient />
    </>
  );
}

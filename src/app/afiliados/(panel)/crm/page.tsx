export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /afiliados/crm — LO QUE EL SOCIO RECOMIENDA.
//
// Antes, recomendar un negocio era mandar un WhatsApp al manager y esperar.
// Aquí el socio lo da de alta él mismo y cae en la MISMA libreta que usa
// DaleControl en /admin/crm, marcada con su nombre. No hay lista paralela:
// si la hubiera, el equipo de ventas tendría que ir a buscarla.
//
// 🔴 SÓLO LO SUYO. `crmAfiliadoListar` filtra por el `affiliateId` de la
// SESIÓN y devuelve un subconjunto estrecho de cada fila: fuera quedan el
// valor estimado, el seguimiento, el motivo de pérdida y la bitácora. Ver
// la cabecera de src/lib/affiliates/crm.ts.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { crmAfiliadoListar } from "@/lib/affiliates/crm";
import { PageHead, PanelCard } from "@/components/afiliados/ui/panel-ui";
import { CrmAfiliadoClient } from "./crm-afiliado-client";

export const metadata: Metadata = { title: "Recomendar negocios — Afiliados DaleControl" };

export default async function Page() {
  // El layout ya cortó al visitante sin sesión; esto es lo que hace falta
  // para SABER de quién es la lista, y de paso vuelve a comprobarlo.
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  let listado;
  try {
    listado = await crmAfiliadoListar(ctx.affiliateId);
  } catch (err) {
    // Casi seguro: falta aplicar sql/crm-dalecontrol.sql en Supabase. Se
    // dice con esas palabras en vez de tumbar el panel del socio.
    console.error("[afiliados/crm] no se pudo leer la lista:", err);
    return (
      <>
        <PageHead title="Recomienda negocios" />
        <PanelCard>
          <p style={{ margin: 0, fontSize: 13, color: "var(--dcafp-ink-2)", lineHeight: 1.6 }}>
            Esta sección todavía no está disponible. Ya avisamos al equipo; vuelve a intentarlo en
            un rato.
          </p>
        </PanelCard>
      </>
    );
  }

  return <CrmAfiliadoClient listado={listado} />;
}

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { getAccountManagerForAffiliate } from "@/lib/account-manager/get-for-affiliate";
import { isOnline, formatSchedule, nextAvailableText } from "@/lib/account-manager/availability";
import { PageHead } from "@/components/afiliados/ui/panel-ui";
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
 *
 * Sin envoltorio propio: `.dcafp-main` ya separa encabezado y contenido.
 */
export default async function AffiliateSupportPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const manager = await getAccountManagerForAffiliate(ctx.affiliateId);
  const now = new Date();
  const online = manager ? isOnline(manager, now) : false;

  return (
    <>
      <PageHead
        title="Soporte"
        sub="Escríbele a tu manager por WhatsApp o abre un ticket: comisiones, pagos, material de venta o cualquier duda de tu cuenta."
      />

      <SoporteAfiliadoClient
        manager={manager}
        online={online}
        scheduleText={manager ? formatSchedule(manager) : ""}
        nextAvailable={manager && !online ? nextAvailableText(manager, now) : ""}
        affiliateName={ctx.affiliate.name}
        referralCode={ctx.affiliate.referralCode}
      />
    </>
  );
}

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/socios — el panel del socio del programa de afiliados.
//
// LOS TRES CANDADOS (modo, feature del plan, permiso), repetidos en la ruta
// de API por openRealtyGrowthGate: esto decide qué se PINTA, aquello decide
// qué se EJECUTA.
//
// FEATURE: `affiliates`, que YA existe en plan-shared.ts y hoy solo trae el
// plan INMOBILIARIA. No se inventó una llave nueva — una que no esté en
// realty_plan_configs deja a TODAS las cuentas fuera hasta que alguien
// corra un UPDATE.
//
// PERMISO: `billing.manage` (OWNER, no MANAGER) y no es un descuido. Esta
// pantalla enseña cuánto se ha ganado y guarda la CLABE a la que se paga.
// Un asesor no tiene por qué poder cambiar a dónde se manda ese dinero.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { REALTY_AFFILIATES_FEATURE } from "@/lib/realty/bot/gate";
import { RealtySociosScreen } from "@/components/realty/growth/socios-screen";
import { PaginaAviso } from "@/components/realty/growth/growth-ui";
import { makeRealtyT } from "@/lib/realty/i18n";
import growthDict from "@/i18n/dictionaries/realty/growth.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "socios";

export const metadata: Metadata = { title: "Socios — DaleControl Inmuebles" };

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // i18n — CONVENCIÓN B: el sub-árbol se recorta AQUÍ y el componente llama
  // a makeRealtyT SIN prefijo.
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (growthDict as unknown as Record<string, Dictionary>)[locale];
  const t = makeRealtyT(dict);

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  if (!realtyPlanHasFeature(ctx.plan, REALTY_AFFILIATES_FEATURE)) {
    return <PaginaAviso texto={t("errores.sinPlan")} />;
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "billing.manage" as RealtyPermissionKey)) {
    return <PaginaAviso texto={t("errores.sinPermiso")} />;
  }

  return (
    <RealtySociosScreen
      dict={dict}
      timeZone={ctx.account.timezone || "America/Mexico_City"}
    />
  );
}

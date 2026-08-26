export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/campanas — campañas, bajas, reseñas e investigación.
//
// LOS TRES CANDADOS (modo, feature del plan, permiso), y los tres se
// REPITEN en cada ruta de API (openRealtyGrowthGate): esto decide qué se
// PINTA, aquello decide qué se EJECUTA. Esconder una pantalla no es control
// de acceso — quien escriba la URL llega igual.
//
// La feature es `whatsappInbox` y NO una llave nueva: sin Inbox no hay
// número con qué mandar. Ver la nota larga de src/lib/realty/bot/gate.ts —
// una llave que no exista en realty_plan_configs deja a TODAS las cuentas
// fuera hasta que alguien corra un UPDATE.
//
// ⚠️ VER (whatsapp.view) Y MANDAR (whatsapp.send) SON DISTINTOS: un asesor
// puede revisar a quién se le mandó y quién pidió la baja; crear una
// campaña, mandarla o reactivar a alguien que se dio de baja, no.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { REALTY_CAMPAIGNS_FEATURE } from "@/lib/realty/bot/gate";
import { RealtyCampanasScreen } from "@/components/realty/growth/campanas-screen";
import { PaginaAviso } from "@/components/realty/growth/growth-ui";
import { makeRealtyT } from "@/lib/realty/i18n";
import growthDict from "@/i18n/dictionaries/realty/growth.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "campanas";

export const metadata: Metadata = { title: "Campañas — DaleControl Inmuebles" };

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

  if (!realtyPlanHasFeature(ctx.plan, REALTY_CAMPAIGNS_FEATURE)) {
    return <PaginaAviso texto={t("errores.sinPlan")} />;
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "whatsapp.view" as RealtyPermissionKey)) {
    return <PaginaAviso texto={t("errores.sinPermiso")} />;
  }
  const puedeEnviar = hasRealtyPermission(permUser, "whatsapp.send" as RealtyPermissionKey);

  return (
    <RealtyCampanasScreen
      dict={dict}
      timeZone={ctx.account.timezone || "America/Mexico_City"}
      accountName={ctx.account.name}
      puedeEnviar={puedeEnviar}
    />
  );
}

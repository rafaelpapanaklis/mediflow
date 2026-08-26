export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/bot — el bot de WhatsApp del vertical.
//
// LOS TRES CANDADOS, ninguno decorativo (mismo criterio que /calculadoras):
//   1. MODO de la cuenta — sale del campo `modes` del contrato, no de un if.
//   2. FEATURE del plan — esconder un menú NO es control de acceso: quien
//      escriba la URL llegaría igual.
//   3. PERMISO del rol.
// Y se REPITEN en cada ruta de API (openRealtyGrowthGate): esto decide qué
// se PINTA, aquello decide qué se EJECUTA.
//
// La feature es `whatsappInbox` y NO una llave nueva: ver la nota larga de
// src/lib/realty/bot/gate.ts. Una llave que no exista en realty_plan_configs
// deja a TODAS las cuentas fuera hasta que alguien corra un UPDATE.
//
// ⚠️ VER (whatsapp.view) Y ENCENDER (whatsapp.send) SON DISTINTOS: un asesor
// puede revisar qué contestó el bot; cambiarle la configuración —o
// encenderlo— es emitir mensajes en nombre de la inmobiliaria.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { REALTY_BOT_FEATURE } from "@/lib/realty/bot/gate";
import { getRealtyWaConnection } from "@/lib/realty/whatsapp";
import { RealtyBotScreen } from "@/components/realty/growth/bot-screen";
import { PaginaAviso } from "@/components/realty/growth/growth-ui";
import { makeRealtyT } from "@/lib/realty/i18n";
import growthDict from "@/i18n/dictionaries/realty/growth.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "bot";

export const metadata: Metadata = { title: "Bot de WhatsApp — DaleControl Inmuebles" };

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // i18n — CONVENCIÓN B: aquí se RECORTA el sub-árbol y el componente llama
  // a makeRealtyT SIN prefijo. growth.json no se cuelga del barril de realty
  // a propósito (ver la nota dentro del JSON).
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (growthDict as unknown as Record<string, Dictionary>)[locale];
  const t = makeRealtyT(dict);

  // El item puede no existir todavía en REALTY_NAV_ITEMS (types.ts está
  // fuera de la allowlist de esta terminal — ver el reporte). Si existe, su
  // `modes` manda; si no, no se inventa un filtro aquí.
  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  if (!realtyPlanHasFeature(ctx.plan, REALTY_BOT_FEATURE)) {
    return <PaginaAviso texto={t("errores.sinPlan")} />;
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "whatsapp.view" as RealtyPermissionKey)) {
    return <PaginaAviso texto={t("errores.sinPermiso")} />;
  }
  const puedeEditar = hasRealtyPermission(permUser, "whatsapp.send" as RealtyPermissionKey);

  // Lo único que se resuelve en el servidor: si hay número. Es lo que
  // decide el aviso de arriba, y no vale la pena un viaje extra para él.
  // El resto del estado lo trae la pantalla de GET /api/realty/bot.
  let conectado = false;
  try {
    conectado = (await getRealtyWaConnection(ctx.accountId)).state === "CONNECTED";
  } catch {
    // Sin conexión de WhatsApp legible se pinta como "no conectado": el
    // aviso sobra si sí lo estaba, pero nunca al revés.
    conectado = false;
  }

  return (
    <RealtyBotScreen
      dict={dict}
      estadoInicial={null}
      conectado={conectado}
      timeZone={ctx.account.timezone || "America/Mexico_City"}
      puedeEditar={puedeEditar}
    />
  );
}

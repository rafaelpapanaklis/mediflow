export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// CUMPLIMIENTO ANTILAVADO (PLD) del panel de inmuebles.
//
// 🔴 QUÉ VENDE ESTA PANTALLA, EXACTAMENTE. Un EXPEDIENTE y unas ALERTAS:
// junta los papeles del cliente, compara cada operación contra el umbral
// vigente y arma el archivo para que el cliente lo suba ÉL al portal del
// SAT. NO presenta avisos, no dictamina y no sustituye a un despacho. Si el
// cliente incumple, las multas son suyas. La leyenda va en el encabezado,
// siempre visible — nunca detrás de un acordeón.
//
// TRES CANDADOS, y ninguno decorativo (mismo orden que las calculadoras):
//   1. MODO de la cuenta — sale del campo `modes` del contrato, no de un if
//      inventado aquí. Es ALL_MODES: el arrendamiento por encima del umbral
//      también es actividad vulnerable, así que un rentista la necesita.
//   2. FEATURE del plan — `pld`, NUNCA `plan === "INMOBILIARIA"`. Hoy la
//      trae solo ese plan, pero un id escrito en duro se rompe el día que
//      se venda como complemento, y se rompe callado.
//   3. PERMISO del rol — pld.view.
// Los tres se repiten en cada ruta de API (ver _guard.ts): esto decide qué
// se PINTA, aquello decide qué se EJECUTA. Esconder el item del menú no es
// control de acceso: quien escriba la URL llegaría igual.
//
// 🔴 SIN PARÁMETROS NO SE CAE. Si nadie capturó la UMA del año,
// getPantallaCumplimiento devuelve `umbrales: null` con la lista de lo que
// falta, y el módulo sigue sirviendo para integrar expedientes. Lo único
// que desaparece es la comparación — que es justo lo que no se puede
// inventar.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getPantallaCumplimiento } from "@/lib/realty/pld/pantalla";
import { CumplimientoScreen } from "@/components/realty/pld/cumplimiento-screen";
import pldDict from "@/i18n/dictionaries/realty/pld.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "cumplimiento";

export const metadata: Metadata = { title: "Cumplimiento antilavado — DaleControl Inmuebles" };

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="realty-page">
      <div
        style={{
          padding: 20,
          borderRadius: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-2)",
          fontSize: 13.5,
          lineHeight: 1.6,
          maxWidth: 620,
        }}
      >
        {texto}
      </div>
    </div>
  );
}

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  // i18n — CONVENCIÓN B: aquí se RECORTA el sub-árbol del idioma y el
  // componente llama a makeRealtyT SIN prefijo. Este diccionario no se
  // cuelga del barril de realty a propósito (ver la nota dentro de pld.json).
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (pldDict as unknown as Record<string, Dictionary>)[locale];

  if (!realtyPlanHasFeature(ctx.plan, "pld")) {
    return <Aviso texto={(dict.errores as Dictionary).sinPlan as string} />;
  }
  if (
    !hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      "pld.view" as RealtyPermissionKey,
    )
  ) {
    return <Aviso texto={(dict.errores as Dictionary).sinPermiso as string} />;
  }

  // Una sola llamada arma la pantalla entera: parámetros, operaciones ya
  // comparadas, expedientes RECORTADOS (el detalle se pide de uno en uno y
  // esa petición se audita), calendario del corte y contactos.
  const datos = await getPantallaCumplimiento(ctx);

  return <CumplimientoScreen dict={dict} datos={datos} locale={locale} />;
}

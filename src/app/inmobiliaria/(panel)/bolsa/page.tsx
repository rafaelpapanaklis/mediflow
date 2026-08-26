export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/bolsa — LA BOLSA INMOBILIARIA (MLS interna).
//
// 🔴 ES LA ÚNICA PANTALLA DEL PRODUCTO QUE ENSEÑA DATOS DE OTRA CUENTA, y
// por eso las guardas de aquí no son las de siempre. Cuatro, en este orden:
//
//   1. SESIÓN      → /login. De aquí sale el accountId y de ningún otro
//                    lado.
//   2. MODO        → /inmobiliaria/inicio. Un rentista (OWNER) administra
//                    lo suyo y no comercializa para terceros: compartir
//                    inventario con otras inmobiliarias no le aplica. Sale
//                    de BROKER_MODES_MLS, el mismo criterio de Prospectos y
//                    Comisiones.
//   3. FEATURE     → pantalla de "otro plan". Se gatea por `mls`, JAMÁS por
//                    `plan.id === "INMOBILIARIA"`: el día que un plan nuevo
//                    la incluya, esto sigue funcionando sin tocarse.
//   4. PERMISO     → pantalla de "sin acceso". `properties.view` y no una
//                    llave `mls.*` nueva, porque `permissionsOverride`
//                    REEMPLAZA los defaults del rol: una llave nueva no la
//                    tendría NADIE con override puesto y esa gente se
//                    quedaría fuera en silencio.
//
// ── ESTA PANTALLA NO ES EL CANDADO ─────────────────────────────────────
// Decide qué se PINTA. Lo que se EJECUTA lo deciden las once rutas de
// /api/realty/mls/**, que repiten los CINCO cortes (los cuatro de aquí más
// la suscripción) en cada llamada. Quien escriba la URL a mano llega igual
// a la pantalla; lo que no llega es a los datos.
//
// ── OJO: NO HAY ITEM DE MENÚ ───────────────────────────────────────────
// `REALTY_NAV_ITEMS` vive en src/lib/realty/types.ts, que esta terminal
// tiene PROHIBIDO tocar. La ruta funciona escribiéndola, pero el sidebar no
// la pinta hasta que se agregue el renglón — está en el reporte de ORQUESTA
// con el texto exacto. Por eso la comprobación de modo NO se hace buscando
// el item en el contrato (como en Calculadoras o Comisiones): aquí ese
// `find` devolvería undefined y la guarda se saltaría sola.
// ═══════════════════════════════════════════════════════════════════════

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import type { RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { BolsaScreen } from "@/components/realty/mls/bolsa-screen";
import { BROKER_MODES_MLS } from "@/components/realty/mls/mls-contract";
import { RealtyDenied } from "@/components/realty/team/denied";
import mlsDict from "@/i18n/dictionaries/realty/mls.json";
import type { Dictionary } from "@/i18n/t";

export const metadata: Metadata = { title: "Bolsa inmobiliaria — DaleControl Inmuebles" };

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // Guarda de MODO. Sin item en el contrato de navegación, la lista de
  // modos la pone el contrato de la bolsa (mls-contract.ts) — que es el
  // mismo archivo del que sale la lista blanca, y por tanto el mismo que
  // habría que auditar de todos modos.
  if (!BROKER_MODES_MLS.includes(ctx.mode)) redirect("/inmobiliaria/inicio");

  // i18n — CONVENCIÓN B: el servidor RECORTA el sub-árbol del idioma y el
  // componente llama a makeRealtyT SIN prefijo. Este diccionario no se
  // cuelga del barril de realty a propósito (ver `_nota` dentro de
  // mls.json): ese archivo lo comparten las terminales de la ola.
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (mlsDict as unknown as Record<string, Dictionary>)[locale];

  if (!realtyPlanHasFeature(ctx.plan, "mls")) {
    const sinPlan = dict.sinPlan as Dictionary;
    return (
      <RealtyDenied
        title={sinPlan.title as string}
        body={sinPlan.body as string}
        cta={{ href: "/inmobiliaria/suscripcion", label: sinPlan.cta as string }}
      />
    );
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const puede = (key: string) => hasRealtyPermission(permUser, key as RealtyPermissionKey);

  if (!puede("properties.view")) {
    const sinPermiso = dict.sinPermiso as Dictionary;
    return (
      <RealtyDenied title={sinPermiso.title as string} body={sinPermiso.body as string} />
    );
  }

  return (
    <BolsaScreen
      dict={dict}
      // La zona horaria viaja SIEMPRE desde el servidor: sin ella el
      // navegador usa la suya y una inmobiliaria de Cancún vería las fechas
      // de una de Tijuana corridas un día.
      timezone={ctx.account.timezone || "America/Mexico_City"}
      // Los dos permisos finos. Se calculan aquí y se bajan como booleanos
      // para que la pantalla no tenga que saber cómo se resuelve un rol —
      // y sobre todo para que no los adivine: cada ruta los vuelve a exigir.
      puedeEditar={puede("properties.edit")}
      puedeAdoptar={puede("web.edit")}
    />
  );
}

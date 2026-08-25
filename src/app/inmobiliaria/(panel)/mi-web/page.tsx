export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { rutaWebInmobiliaria } from "@/lib/realty/landing";
import { SITE_URL } from "@/lib/seo";
import { cargarWebRealty } from "@/app/i/[slug]/_shared/data";
import { EditorWebInmuebles } from "@/components/realty/web/editor/editor";
import { UpsellWebInmuebles } from "@/components/realty/web/editor/upsell";

/* ═══════════════════════════════════════════════════════════════════════
   /inmobiliaria/mi-web — el editor de la web pública.

   ── EL EDITOR Y LA PÁGINA PÚBLICA USAN EL MISMO CARGADOR ─────────
   cargarWebRealty() es exactamente el que usa /i/[slug]. La vista previa no
   puede enseñar algo que la página real no tenga: si fueran dos consultas
   distintas, se separarían al primer cambio y el editor mentiría.

   ── LAS TRES PUERTAS, OTRA VEZ ───────────────────────────────────
   El layout ya esconde el item del menú, pero esconder un botón no es
   control de acceso: quien escriba la URL a mano llegaría igual. Aquí van
   el recorte por MODO (del mismo campo `modes` del contrato, no de un if
   inventado), el permiso `web.edit` y la feature `webEditor` del plan. La
   cuarta puerta —la que de verdad importa— está en el PATCH.
   ═══════════════════════════════════════════════════════════════════════ */

const AREA = "mi-web";

export default async function PaginaMiWeb() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const puedeEditar = hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "web.edit" as RealtyPermissionKey,
  );
  if (!puedeEditar) redirect("/inmobiliaria/inicio");

  const carga = await cargarWebRealty(ctx.account.slug);
  if (!carga) {
    // La cuenta existe (hay sesión) pero el cargador no devolvió nada: o la
    // tabla no está migrada, o la base no responde. Se dice tal cual en vez
    // de pintar un editor vacío que perdería lo que se escriba en él.
    return (
      <div className="realty-page">
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Mi web</h1>
        <p style={{ color: "var(--text-2)", fontSize: 14, maxWidth: "62ch" }}>
          No pudimos cargar tu web pública. Si acabas de dar de alta la cuenta, falta aplicar{" "}
          <code>sql/realty.sql</code> en Supabase. Inténtalo de nuevo en un momento.
        </p>
      </div>
    );
  }

  const urlPublica = `${SITE_URL}${rutaWebInmobiliaria(ctx.account.slug)}`;

  // El plan da la web (publicWeb) pero no siempre el EDITOR (webEditor).
  // Se pregunta por la feature y NUNCA por el id del plan: la tabla
  // realty_plan_configs se edita sin redeploy.
  if (!realtyPlanHasFeature(ctx.plan, "webEditor")) {
    return (
      <div className="realty-page">
        <UpsellWebInmuebles
          data={{ ...carga.data, editando: false }}
          urlPublica={urlPublica}
          nombrePlan={ctx.plan.name}
        />
      </div>
    );
  }

  // 🔴 La versión, el Json crudo, la plantilla y `publicada` salen TODOS de
  // `carga`, o sea de UNA sola lectura de la fila. Antes había una segunda
  // consulta aquí solo para la `version`, y entre las dos cabía un guardado
  // de otra pestaña: el editor recibía la versión NUEVA con la plantilla y
  // el `publicada` VIEJOS, y como la versión coincidía, el siguiente
  // guardado entraba por el camino directo y reponía los valores viejos —
  // una web recién apagada volvía a estar en línea sin que nadie lo pidiera.
  return (
    <div className="realty-page">
      <EditorWebInmuebles
        data={carga.data}
        template={carga.data.manifest.id}
        config={carga.configCruda ?? carga.data.config}
        version={carga.version}
        publicada={carga.publicada}
        modo={ctx.mode}
        urlPublica={urlPublica}
      />
    </div>
  );
}

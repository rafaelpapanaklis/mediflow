export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import {
  getPortalMatrix,
  getPortalsOverview,
  processPortalQueueForAccount,
} from "@/lib/realty/portals";
import { RealtyPortalsScreen } from "@/components/realty/portals/portals-screen";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { Dictionary } from "@/i18n/t";
import portalsDict from "@/i18n/dictionaries/realty/portals.json";

const AREA = "portales";

/**
 * /inmobiliaria/portales — el feed propio y el estado en cada destino.
 *
 * Tres candados, los mismos que la API (esconder el menú NO es control de
 * acceso: quien escriba la URL a mano llegaría igual):
 *   1. sesión de inmobiliaria
 *   2. modo de la cuenta, sacado del MISMO campo `modes` del contrato
 *   3. feature del plan + permiso del rol
 *
 * El diccionario se importa DIRECTO y se le pasa el sub-árbol del idioma ya
 * recortado, con prefijo VACÍO. No se registra en
 * src/i18n/dictionaries/realty/index.ts a propósito: ese archivo lo comparten
 * las diez terminales de la Ola 1 y registrar aquí obligaría a que las diez
 * tocaran el mismo import. Ver la nota dentro del propio JSON.
 */
export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (portalsDict as Record<string, unknown>)[locale] as Dictionary;
  const t = makeRealtyT(dict);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "portals.manage")) {
    return <Aviso title={t("sinPermiso.title")} body={t("sinPermiso.body")} />;
  }
  if (!realtyPlanHasFeature(ctx.plan, "portalsFeed")) {
    return (
      <Aviso
        title={t("sinPlan.title")}
        body={t("sinPlan.body")}
        cta={{ href: "/inmobiliaria/suscripcion", label: t("sinPlan.cta") }}
      />
    );
  }

  // 🔴 RECONCILIAR AL ABRIR LA PANTALLA.
  //
  // El cron todavía no está dado de alta (vercel.json es compartido y está
  // fuera del vertical), y sin él la matriz se quedaría diciendo "Publicada"
  // de un inmueble vendido hasta que alguien pulsara el botón. Una pasada
  // aquí lo arregla y cuesta casi nada: la cola solo ESCRIBE donde el estado
  // deseado difiere del real, así que en régimen normal son cuatro consultas
  // y cero UPDATE.
  //
  // En try/catch y antes de leer: si falla, la pantalla se pinta igual con lo
  // que haya en la base. Una reconciliación no puede tumbar una pantalla.
  try {
    await processPortalQueueForAccount(ctx.accountId);
  } catch (e) {
    console.error("[portales] la reconciliación al abrir falló", e);
  }

  // Las dos consultas en paralelo: la matriz es la cara del producto y no
  // debe esperar a que termine el panorama.
  const [overview, matrix] = await Promise.all([
    getPortalsOverview(ctx.accountId),
    getPortalMatrix(ctx.accountId),
  ]);

  return (
    <RealtyPortalsScreen
      dict={dict}
      initialOverview={overview}
      initialMatrix={matrix}
      timezone={ctx.account.timezone || "America/Mexico_City"}
    />
  );
}

/** Puerta cerrada, con el motivo y la salida. Nunca una pantalla en blanco. */
function Aviso({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="realty-page">
      <div
        style={{
          maxWidth: 520,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          padding: "clamp(20px, 3vw, 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h1 style={{ fontSize: 19, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: 0, lineHeight: 1.65 }}>{body}</p>
        {cta ? (
          <a
            href={cta.href}
            className="realty-btn-primary"
            style={{
              alignSelf: "flex-start",
              padding: "9px 16px",
              fontSize: 13,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            {cta.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { getLeadDetail, getLeadsCatalogs } from "@/lib/realty/leads";
import { LeadDetail } from "@/components/realty/leads/lead-detail";

const AREA = "prospectos";

/** FICHA DEL PROSPECTO: datos, qué busca, match y la bitácora completa. */
export default async function Page({ params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");
  if (ctx.plan.features.leads !== true) redirect("/inmobiliaria/suscripcion");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "leads.view")) redirect("/inmobiliaria/inicio");

  const dict = (getRealtyDict(ctx.account.locale).realty as Dictionary).leads as Dictionary;

  const [lead, catalogs] = await Promise.all([
    getLeadDetail(ctx.accountId, params.id, {
      role: ctx.role,
      realtyUserId: ctx.realtyUserId,
      permissionsOverride: ctx.user.permissionsOverride,
    }),
    getLeadsCatalogs(ctx.accountId),
  ]);

  // 404 propio (no notFound()) para que la persona vuelva al embudo sin
  // salirse del shell del vertical.
  if (!lead) {
    const t = (dict.detail as Dictionary | undefined)?.notFound;
    const back = (dict.actions as Dictionary | undefined)?.back;
    return (
      <div className="realty-page">
        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            padding: "28px 22px",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>
            {typeof t === "string" ? t : "Ese prospecto no existe o no es tuyo."}
          </p>
          <Link
            href="/inmobiliaria/prospectos"
            style={{
              display: "inline-block",
              marginTop: 14,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--brand)",
            }}
          >
            {typeof back === "string" ? back : "Volver a prospectos"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <LeadDetail
      dict={dict}
      locale={ctx.account.locale === "en" ? "en-US" : "es-MX"}
      initial={lead}
      catalogs={catalogs}
      canEdit={hasRealtyPermission(permUser, "leads.edit")}
      canAssign={hasRealtyPermission(permUser, "leads.assign")}
      timeZone={ctx.account.timezone}
      meId={ctx.realtyUserId}
    />
  );
}

import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import {
  BARBER_CAMPAIGN_AUDIENCES,
  CAMPAIGN_BATCH_MAX,
  CAMPAIGN_PROMO_MAX,
  CAMPAIGN_TOKENS,
  MEMBERSHIP_EXPIRING_DAYS,
  NO_SHOW_MIN,
  getBarberCampaignConfig,
} from "@/lib/barber/campaigns";
import { getBarberClientsConfig } from "@/lib/barber/clients";
import { getBarberWaConnection } from "@/lib/barber/whatsapp";
import { BARBER_WA_PRICE_USD } from "@/lib/barber/whatsapp-core";
import { CampanasScreen } from "@/components/barber/campanas/campanas-screen";
import { CAMPAIGNS_FEATURE } from "@/app/api/barber/campaigns/_server";

export const dynamic = "force-dynamic";

/**
 * /barber/campanas — las campañas de retención de la barbería.
 *
 * EL GATE ESTÁ AQUÍ (server) Y TAMBIÉN EN CADA API. No es duplicado inútil:
 * esta comprobación decide qué se PINTA, y la de las rutas decide qué se
 * EJECUTA. Un plan Básico no ve la pantalla, y si llamara a la API a mano
 * tampoco pasaría — el navegador nunca es la última palabra.
 *
 * La misma feature que la bandeja (`whatsappInbox` = Avanzado y
 * Profesional): ver el razonamiento en /api/barber/campaigns/_server.ts.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).campanas ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const plan = await getBarberPlan(ctx.barbershop.plan);

  if (plan.features[CAMPAIGNS_FEATURE] !== true) {
    return <Notice text={t("barber.campanas.errors.noPlan")} />;
  }
  if (!hasBarberPermission(permUser, "whatsapp.view")) {
    return <Notice text={t("barber.campanas.errors.noPermission")} />;
  }

  const [config, clientsConfig, connection] = await Promise.all([
    getBarberCampaignConfig(ctx),
    getBarberClientsConfig(ctx),
    getBarberWaConnection(ctx.barbershopId),
  ]);

  return (
    <CampanasScreen
      dict={dict}
      locale={locale}
      audiences={BARBER_CAMPAIGN_AUDIENCES.map((a) => ({
        id: a.id,
        repeatAfterDays: a.repeatAfterDays,
      }))}
      config={{
        cooldownDays: config.cooldownDays,
        templates: config.templates,
        persisted: config.persisted,
      }}
      limits={{
        batchMax: CAMPAIGN_BATCH_MAX,
        promoMax: CAMPAIGN_PROMO_MAX,
        tokens: Array.from(CAMPAIGN_TOKENS),
        inactiveDays: clientsConfig.inactiveDays,
        membershipExpiringDays: MEMBERSHIP_EXPIRING_DAYS,
        noShowMin: NO_SHOW_MIN,
        unitUsd: BARBER_WA_PRICE_USD.MARKETING,
      }}
      canSend={hasBarberPermission(permUser, "whatsapp.send")}
      canEditTemplates={hasBarberPermission(permUser, "settings.edit")}
      canEditClients={hasBarberPermission(permUser, "clients.edit")}
      waConnected={connection.state === "CONNECTED" || connection.state === "UNVERIFIED"}
    />
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div
      style={{
        maxWidth: 520,
        margin: "12vh auto 0",
        padding: "clamp(20px, 4vw, 32px)",
        borderRadius: 16,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        textAlign: "center",
        fontSize: 14,
        lineHeight: 1.6,
        color: "var(--text-2)",
      }}
    >
      {text}
    </div>
  );
}

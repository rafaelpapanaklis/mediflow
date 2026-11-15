import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import { getBarberWaQuota } from "@/lib/barber/whatsapp";
import { InboxPanel } from "@/components/barber/whatsapp/inbox-panel";
import { WaI18n } from "@/components/barber/whatsapp/ui";

export const dynamic = "force-dynamic";

/**
 * /barber/mensajes — la bandeja de WhatsApp, con entrada propia en el menú
 * (antes era la pestaña «Conversaciones» de /barber/whatsapp).
 *
 * Mismo candado que sus APIs: permiso whatsapp.view + feature whatsappInbox.
 * Y el de pago, como todas las pantallas del panel.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = getBarberDict(locale);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "whatsapp.view")) {
    return <Notice text={t("barber.whatsapp.errors.noPermission")} />;
  }
  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (!barberPlanHasFeature(plan, "whatsappInbox")) {
    return <Notice text={t("barber.whatsapp.errors.planLocked")} />;
  }

  const quota = await getBarberWaQuota(ctx.barbershopId);

  return (
    <WaI18n dict={dict}>
      <InboxPanel
        locale={locale}
        canSend={hasBarberPermission(permUser, "whatsapp.send")}
        quota={quota}
      />
    </WaI18n>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div
      style={{
        maxWidth: 520,
        margin: "12vh auto 0",
        padding: "clamp(20px, 4vw, 32px)",
        borderRadius: "var(--radius-lg)",
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

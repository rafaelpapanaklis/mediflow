import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import { getBarberWaConnection } from "@/lib/barber/whatsapp";
import { getBarberBotPanelState } from "@/lib/barber/bot";
import { BarberBotScreen } from "@/components/barber/bot/bot-screen";

/**
 * /barber/whatsapp/bot — el bot que agenda.
 *
 * El servidor resuelve TODO lo que decide qué se ve: la sesión (y con ella
 * el barbershopId), el plan y los permisos del rol. El componente cliente
 * solo pinta y pide: no puede ampliar su propio alcance.
 *
 * El bot es del plan PROFESIONAL. Este candado está también en
 * /api/barber/bot (servidor): esta pantalla es la cortesía, aquel es el
 * candado de verdad.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = getBarberDict(locale);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "whatsapp.view")) {
    return <Notice text={t("barber.bot.errors.noPermission")} />;
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (!barberPlanHasFeature(plan, "whatsappBot")) {
    return <Notice text={t("barber.bot.errors.planLocked")} />;
  }

  const [state, connection] = await Promise.all([
    getBarberBotPanelState(ctx.barbershopId, ctx.barbershop.timezone),
    getBarberWaConnection(ctx.barbershopId),
  ]);

  return (
    <BarberBotScreen
      dict={dict}
      locale={locale}
      initial={state}
      connected={connection.state === "CONNECTED"}
      canEdit={hasBarberPermission(permUser, "settings.edit")}
      canAttend={hasBarberPermission(permUser, "whatsapp.send")}
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

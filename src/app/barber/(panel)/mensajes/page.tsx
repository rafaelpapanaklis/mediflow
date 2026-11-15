import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import { getBarberWaConnection, getBarberWaQuota, listBarberThreads } from "@/lib/barber/whatsapp";
import { isBarberWaLinked, isBarberWaUnlimited } from "@/lib/barber/whatsapp-core";
import { getBarberBotSettings, listBarberBotPauses } from "@/lib/barber/bot";
import { MensajesScreen } from "@/components/barber/mensajes/mensajes-screen";

export const dynamic = "force-dynamic";

/**
 * /barber/mensajes — la bandeja de WhatsApp, con entrada propia en el menú
 * (antes era la pestaña «Conversaciones» de /barber/whatsapp).
 *
 * Mismo candado que sus APIs: permiso whatsapp.view + feature whatsappInbox.
 * Y el de pago, como todas las pantallas del panel.
 *
 * El servidor resuelve lo que decide qué se ve (sesión, plan, permisos) y
 * trae la primera pintura: los chats, si hay WhatsApp conectado y, si el
 * plan trae bot, si está encendido y en qué chats está en pausa. Todo con
 * las MISMAS funciones que ya usan las APIs; nada nuevo en el servidor.
 */
export default async function Page(props: { searchParams: Promise<{ tel?: string | string[] }> }) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  // Después del candado (candado-suscripcion lo exige como segundo await).
  const { tel } = await props.searchParams;

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

  const shopId = ctx.barbershopId;
  const conBot = barberPlanHasFeature(plan, "whatsappBot");
  const [connection, quota, threads, botSettings, pauses] = await Promise.all([
    getBarberWaConnection(shopId),
    getBarberWaQuota(shopId),
    listBarberThreads(shopId).catch(() => []),
    conBot ? getBarberBotSettings(shopId).catch(() => null) : Promise.resolve(null),
    conBot ? listBarberBotPauses(shopId) : Promise.resolve([]),
  ]);

  const connected = isBarberWaLinked(connection.state);
  const canSend = hasBarberPermission(permUser, "whatsapp.send");
  const telefono = typeof tel === "string" ? tel.replace(/\D/g, "").slice(-10) : "";

  return (
    <MensajesScreen
      dict={dict}
      locale={locale}
      timezone={ctx.barbershop.timezone}
      nowISO={new Date().toISOString()}
      initial={{
        threads,
        pauses,
        bot: {
          disponible: conBot,
          encendido: botSettings?.settings.enabled === true,
          conectado: connected,
        },
        connected,
        quotaExhausted: !isBarberWaUnlimited(quota.limit) && quota.exhausted,
      }}
      can={{
        send: canSend,
        attend: canSend && conBot,
        clients:
          barberPlanHasFeature(plan, "clients") && hasBarberPermission(permUser, "clients.view"),
        agenda: barberPlanHasFeature(plan, "agenda") && hasBarberPermission(permUser, "agenda.view"),
        book:
          barberPlanHasFeature(plan, "agenda") &&
          hasBarberPermission(permUser, "agenda.edit") &&
          barberPlanHasFeature(plan, "clients") &&
          hasBarberPermission(permUser, "clients.view"),
      }}
      initialPhone={telefono.length === 10 ? telefono : null}
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

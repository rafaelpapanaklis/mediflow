import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import {
  getBarberWaConnection,
  getBarberWaQuota,
  listBarberTemplates,
} from "@/lib/barber/whatsapp";
import { BARBER_WA_TEMPLATES } from "@/lib/barber/whatsapp-core";
import {
  BarberWhatsAppScreen,
  type WaStatusPayload,
} from "@/components/barber/whatsapp/whatsapp-screen";

export const dynamic = "force-dynamic";

/**
 * /barber/whatsapp — conexión, conversaciones, plantillas y campañas.
 *
 * El servidor resuelve TODO lo que decide qué se ve: la sesión (y con ella
 * el barbershopId), el plan y los permisos del rol. El componente cliente
 * solo pinta y pide: no puede ampliar su propio alcance.
 *
 * DOS FEATURES, a propósito:
 *   · whatsappReminders (TODOS los planes) abre la pantalla: es donde la
 *     barbería CONECTA su número, y sin número no hay recordatorios — que sí
 *     están incluidos hasta en el Básico.
 *   · whatsappInbox (Avanzado y Profesional) abre las conversaciones y las
 *     campañas.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = getBarberDict(locale);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "whatsapp.view")) {
    return <Notice text={t("barber.whatsapp.errors.noPermission")} />;
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (!barberPlanHasFeature(plan, "whatsappReminders")) {
    return <Notice text={t("barber.whatsapp.errors.planLocked")} />;
  }

  const [connection, quota] = await Promise.all([
    getBarberWaConnection(ctx.barbershopId),
    getBarberWaQuota(ctx.barbershopId),
  ]);

  // Las plantillas se leen de Meta EN VIVO, y solo si hay conexión: sin token
  // no hay nada que preguntar y la llamada retrasaría la primera pintura.
  const templates: WaStatusPayload["templates"] =
    connection.state === "DISCONNECTED"
      ? {
          ok: false,
          reason: null,
          templates: BARBER_WA_TEMPLATES.map((tpl) => ({
            kind: tpl.kind,
            name: tpl.name,
            category: tpl.category,
            status: "MISSING",
            reason: null,
            optional: tpl.optional,
          })),
        }
      : await listBarberTemplates(ctx.barbershopId);

  return (
    <BarberWhatsAppScreen
      dict={dict}
      locale={locale}
      initial={{ connection, quota, templates }}
      hasInbox={barberPlanHasFeature(plan, "whatsappInbox")}
      canEdit={hasBarberPermission(permUser, "settings.edit")}
      canSend={hasBarberPermission(permUser, "whatsapp.send")}
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

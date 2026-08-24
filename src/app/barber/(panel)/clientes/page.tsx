import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { listBarberClients } from "@/lib/barber/clients";
import { BarberClientsScreen } from "@/components/barber/clients/clients-screen";

export const dynamic = "force-dynamic";

/**
 * /barber/clientes — la agenda de clientes de la barbería.
 *
 * El servidor resuelve TODO lo que decide qué se ve: la sesión (y con ella
 * el barbershopId), el plan y los permisos del rol. El componente cliente
 * solo pinta y pide más páginas: no puede ampliar su propio alcance.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).clientes ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const plan = await getBarberPlan(ctx.barbershop.plan);

  if (plan.features.clients !== true) {
    return <Notice text={t("barber.clientes.errors.noPermission")} />;
  }
  if (!hasBarberPermission(permUser, "clients.view")) {
    return <Notice text={t("barber.clientes.errors.noPermission")} />;
  }

  const initial = await listBarberClients(ctx, { filter: "all", page: 1 });

  return (
    <BarberClientsScreen
      dict={dict}
      locale={locale}
      initial={initial}
      canEdit={hasBarberPermission(permUser, "clients.edit")}
      canEditSettings={hasBarberPermission(permUser, "settings.edit")}
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

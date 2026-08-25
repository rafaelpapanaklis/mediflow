export const dynamic = "force-dynamic";

import "@/components/barber/dashboard/dashboard.css";
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { listBranchOptions, readBranchCookie } from "@/lib/barber/branches";
import { getInicioSummary } from "@/lib/barber/stats";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { InicioView } from "@/components/barber/dashboard/inicio-view";

/**
 * /barber/inicio — lo primero que ve la barbería al entrar: el resumen del
 * día. Va en TODOS los planes (no hay feature que lo cierre). Sin sesión →
 * /login; barbería inactiva o impaga → /barber/suscripcion, igual que el
 * router de /barber. El alcance (sede del selector, rol BARBER = solo lo
 * suyo) lo decide getInicioSummary en el servidor: la vista solo pinta.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  if (!ctx.barbershop.isActive || !isBarbershopSubscriptionActive(ctx.barbershop)) {
    redirect("/barber/suscripcion");
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const summary = await getInicioSummary(ctx, { branchId: readBranchCookie(), features: plan.features });
  const branches = summary.scope.canConsolidate ? await listBranchOptions(ctx) : [];

  return (
    <InicioView
      summary={summary}
      t={t}
      locale={ctx.barbershop.locale}
      firstName={ctx.user.firstName}
      branches={branches.map((b) => ({ id: b.id, label: b.label }))}
      slug={ctx.barbershop.slug}
    />
  );
}

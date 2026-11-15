export const dynamic = "force-dynamic";

import "@/components/barber/dashboard/dashboard.css";
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { listBranchOptions, readBranchCookie } from "@/lib/barber/branches";
import { getInicioSummary } from "@/lib/barber/stats";
import { prisma } from "@/lib/prisma";
import { normalizarConfigBarberWeb } from "@/lib/barber/landing";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { InicioView } from "@/components/barber/dashboard/inicio-view";

/**
 * /barber/inicio — lo primero que ve la barbería al entrar: el resumen del
 * día. Va en TODOS los planes (no hay feature que lo cierre). Sin sesión →
 * /login; barbería inactiva o impaga → /barber/suscripcion, que es lo que
 * hace requireBarberPaidAccess: esta pantalla tenía su propia copia de la
 * regla y ahora usa la ÚNICA, la misma de las otras 23. El alcance (sede
 * del selector, rol BARBER = solo lo suyo) lo decide getInicioSummary en el
 * servidor: la vista solo pinta.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const summary = await getInicioSummary(ctx, { branchId: await readBranchCookie(), features: plan.features });
  const branches = summary.scope.canConsolidate ? await listBranchOptions(ctx) : [];

  // Paso 6 («Tu página web»): «lista» = la página está EN LÍNEA, que es lo que
  // dice Mi web. Antes se medía con «alguna vez se publicó un cambio», y una
  // página que ya se veía en /b/<slug> salía «pendiente». Está en línea
  // mientras no esté apagada («muy pronto»).
  // La sede es la que YA resolvió el resumen (`summary.scope`, validada contra
  // las sedes que la sesión alcanza): con el selector en otra sede, el paso mira
  // la web de esa sede; en la vista de toda la cadena, la de la sesión.
  const webShopId = summary.scope.activeBranchId ?? ctx.barbershopId;
  const [landing, webShop] = await Promise.all([
    prisma.barberLandingConfig
      .findUnique({ where: { barbershopId: webShopId }, select: { config: true } })
      .catch(() => null), // sin tabla/fila: la página base igual se ve
    webShopId === ctx.barbershopId
      ? Promise.resolve({ isActive: ctx.barbershop.isActive })
      : prisma.barbershop.findUnique({ where: { id: webShopId }, select: { isActive: true } }),
  ]);
  const webOnline = Boolean(webShop?.isActive) && !normalizarConfigBarberWeb(landing?.config).oculta;

  return (
    <InicioView
      summary={{ ...summary, setup: { ...summary.setup, hasWeb: webOnline } }}
      t={t}
      locale={ctx.barbershop.locale}
      firstName={ctx.user.firstName}
      branches={branches.map((b) => ({ id: b.id, label: b.label }))}
      slug={ctx.barbershop.slug}
    />
  );
}

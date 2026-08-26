export const dynamic = "force-dynamic";

import "@/components/barber/dashboard/dashboard.css";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { listBranchOptions, readBranchCookie } from "@/lib/barber/branches";
import { canViewReports, getReportsSummary, isStatsScopeError } from "@/lib/barber/stats";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { BarberDenied } from "@/components/barber/cash/denied";
import { ReportesView } from "@/components/barber/dashboard/reportes-view";

/**
 * /barber/reportes?range=today|week|month|custom&from=&to=&branch=&barber=
 *
 * Gate en el SERVIDOR (aquí y en /api/barber/stats/reports):
 *   · plan con la feature `analytics` (Profesional) → si no, tarjeta de plan;
 *   · permiso cash.view o commissions.view → si no, tarjeta de permiso.
 * Un rol BARBER recibe SOLO lo suyo (getReportsSummary recorta por su fila
 * Barber); pedir ?barber= ajeno se ignora y se vuelve a la vista propia.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const locale = ctx.barbershop.locale;
  const t = getBarberT(locale);
  const dict = (getBarberDict(locale).barber as Dictionary).reportes as Dictionary;

  if (!barberPlanHasFeature(plan, "analytics")) {
    return (
      <BarberDenied
        kind="plan"
        title={t("barber.reportes.locked.title")}
        body={t("barber.reportes.locked.body")}
        ctaLabel={t("barber.reportes.locked.cta")}
      />
    );
  }
  if (!canViewReports(ctx)) {
    return (
      <BarberDenied
        kind="permission"
        title={t("barber.reportes.noPermission.title")}
        body={t("barber.reportes.noPermission.body")}
      />
    );
  }

  const sp = (key: string): string | null => {
    const v = searchParams[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  let summary;
  try {
    summary = await getReportsSummary(ctx, {
      range: sp("range"),
      from: sp("from"),
      to: sp("to"),
      branchId: sp("branch") ?? readBranchCookie(),
      barberId: sp("barber"),
      features: plan.features,
    });
  } catch (e) {
    if (isStatsScopeError(e)) redirect("/barber/reportes");
    throw e;
  }

  const [branches, barbers] = await Promise.all([
    summary.scope.canConsolidate ? listBranchOptions(ctx) : Promise.resolve([]),
    summary.scope.selfOnly
      ? Promise.resolve([])
      : prisma.barber.findMany({
          where: { barbershopId: { in: summary.scope.branchIds }, isActive: true },
          select: { id: true, name: true, nickname: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
  ]);

  const currentBranch = summary.scope.consolidated ? "all" : summary.scope.activeBranchId ?? "";
  const currentBarber = !summary.scope.selfOnly && summary.scope.barberIds && summary.scope.barberIds.length === 1
    ? summary.scope.barberIds[0]
    : "";

  return (
    <ReportesView
      dict={dict}
      summary={summary}
      locale={locale}
      branches={branches.map((b) => ({ id: b.id, label: b.label }))}
      barbers={barbers.map((b) => ({ id: b.id, label: b.nickname || b.name }))}
      currentBranch={currentBranch}
      currentBarber={currentBarber}
    />
  );
}

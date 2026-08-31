export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPlan } from "@/lib/edu/pagos";
import { eduSafeTimeZone, eduTodayISO } from "@/lib/edu/agenda-core";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPlanRecibo } from "@/components/edu/dinero/plan-recibo";

export const metadata: Metadata = {
  title: "Recibo del plan · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/caja/planes/[id]/recibo — el recibo IMPRIMIBLE del plan, con
 * el calendario de pagos completo. Es lo que se le entrega al paciente al
 * armar el plan, y lo que se reimprime cuando pregunta cuánto le falta.
 *
 * Mismas dos cerraduras que toda la caja. El plan se busca DENTRO del
 * alcance: uno de otra escuela da 404, igual que uno que no existe.
 *
 * 🔴 Los INSTANTES (cuándo se armó, cuándo se pagó cada mensualidad) se
 * formatean AQUÍ, en el servidor y en la zona del instituto: en el
 * cliente pintarían la zona del navegador y romperían la hidratación.
 */
export default async function InstitutoPlanReciboPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "caja.view")) {
    return (
      <EduDenied
        permission="caja.view"
        what="El recibo de un plan de pagos: su calendario de mensualidades y lo que falta."
      />
    );
  }

  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Recibo del plan</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const plan = await getEduPlan(ctx, ctx.institution.timezone, params.id);
  if (!plan) notFound();

  const zona = eduSafeTimeZone(ctx.institution.timezone);
  const fechaHora = new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const fecha = new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const paidLabels: Record<string, string> = {};
  for (const i of plan.installments) {
    if (i.paidAt) paidLabels[i.id] = fecha.format(new Date(i.paidAt));
  }

  return (
    <div className="edu-page">
      <EduPlanRecibo
        plan={plan}
        institutionName={ctx.institution.name}
        // El MISMO hoy (misma función, misma zona) con el que getEduPlan
        // derivó los estados un instante antes.
        todayISO={eduTodayISO(zona)}
        creadoLabel={fechaHora.format(new Date(plan.createdAt))}
        paidLabels={paidLabels}
      />
    </div>
  );
}

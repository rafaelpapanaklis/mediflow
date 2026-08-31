export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CAJA_MAX_ROWS } from "@/lib/edu/dinero-core";
import { parseEduPlanFilters } from "@/lib/edu/pagos-core";
import { listEduPlanes } from "@/lib/edu/pagos";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPlanesScreen } from "@/components/edu/dinero/planes-screen";

export const metadata: Metadata = {
  title: "Pagos a meses · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/caja/planes — los pagos a meses: planes activos y qué
 * mensualidades vencen esta semana.
 *
 * DOS CERRADURAS, como toda la caja:
 *  1. el PERMISO "caja.view" abre la pantalla;
 *  2. el ALCANCE del dinero (visibility.ts, recurso "charges") decide si
 *     hay filas. Para DOCENTE y ALUMNO no las hay pase lo que pase — un
 *     alumno no ve el plan de su propio paciente, igual que no ve su
 *     saldo.
 *
 * 🔴 Los estados VENCIDA de cada mensualidad se derivan en la LECTURA,
 * contra el hoy del instituto — abrir esta pantalla es lo único que hace
 * falta para que estén al día. No hay ningún cron que, si falla, deje la
 * cartera diciendo "al corriente".
 */
export default async function InstitutoPlanesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "caja.view")) {
    return (
      <EduDenied
        permission="caja.view"
        what="Los pagos a meses de la clínica: los planes, sus mensualidades y lo que vence."
      />
    );
  }

  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Pagos a meses</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const canCharge = hasEduPermission(permUser, "caja.charge");
  const canRefund = hasEduPermission(permUser, "caja.refund");

  const filters = parseEduPlanFilters(searchParams);
  const page = await listEduPlanes(ctx, ctx.institution.timezone, filters);

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/caja" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Caja
        </Link>
      </p>

      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Pagos a meses</h1>
          <p className="edu-page__lead">
            El saldo de un cobro, partido en mensualidades con su fecha. Cada una se cobra como un
            pago normal — entra al turno abierto y a su corte — y una vencida lo está por el
            calendario, no porque un proceso la haya marcado.
          </p>
        </div>
      </header>

      <EduPlanesScreen
        page={page}
        filters={filters}
        maxRows={EDU_CAJA_MAX_ROWS}
        canCharge={canCharge}
        canRefund={canRefund}
      />
    </div>
  );
}

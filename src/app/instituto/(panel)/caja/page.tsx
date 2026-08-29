export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CAJA_MAX_ROWS, parseEduChargeFilters } from "@/lib/edu/dinero-core";
import { getEduOpenCashSession, listEduCharges } from "@/lib/edu/caja";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCajaScreen } from "@/components/edu/dinero/caja-screen";

export const metadata: Metadata = {
  title: "Caja · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/caja — cobrar.
 *
 * DOS CERRADURAS, no una:
 *  1. el PERMISO "caja.view" abre la pantalla;
 *  2. el ALCANCE del dinero (visibility.ts, recurso "charges") decide si
 *     hay filas. Para DOCENTE y ALUMNO no las hay pase lo que pase — ni
 *     con el permiso encendido a mano desde la pantalla de permisos.
 *
 * Esa segunda cerradura es la que pediste explícitamente: un alumno no ve
 * ni el precio, ni el cobro, ni el saldo.
 */
export default async function InstitutoCajaPage({
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
        what="La caja de la clínica: los cobros del turno, sus pagos y su saldo."
      />
    );
  }

  // 🔴 La segunda cerradura. El permiso puede estar encendido y el alcance
  // seguir siendo "ninguna fila": el dinero no es de docentes ni de alumnos.
  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Caja</h1>
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
  const canCorte = hasEduPermission(permUser, "caja.corte");

  const filters = parseEduChargeFilters(searchParams);
  const [page, turno] = await Promise.all([
    listEduCharges(ctx, filters),
    getEduOpenCashSession(ctx),
  ]);

  // La hora se formatea EN EL SERVIDOR y en la zona del INSTITUTO. Hacerlo
  // en el cliente pintaría la del navegador y rompería la hidratación.
  const zona = eduSafeTimeZone(ctx.institution.timezone);
  const turnoAbierto = turno
    ? {
        id: turno.id,
        openedAtLabel: new Intl.DateTimeFormat("es-MX", {
          timeZone: zona,
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(turno.openedAt),
      }
    : null;

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Caja</h1>
          <p className="edu-page__lead">
            Eliges al paciente y el sistema pone su tarifa: si lo trajo un alumno, paga la lista de
            alumno, y lo dice con el nombre de quien lo trajo. Aquí no se teclean precios.
          </p>
        </div>
      </header>

      <EduCajaScreen
        page={page}
        filters={filters}
        maxRows={EDU_CAJA_MAX_ROWS}
        turnoAbierto={turnoAbierto}
        canCharge={canCharge}
        canRefund={canRefund}
        canCorte={canCorte}
      />
    </div>
  );
}

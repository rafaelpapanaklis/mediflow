export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  EDU_INVOICE_MAX_ROWS,
  parseEduInvoiceFilters,
} from "@/lib/edu/facturacion-core";
import { getEduFiscalConfig, listEduInvoices } from "@/lib/edu/facturacion";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduFacturacionScreen } from "@/components/edu/facturacion/facturacion-screen";

export const metadata: Metadata = {
  title: "Facturación · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/facturacion — las facturas del instituto.
 *
 * DOS CERRADURAS, las mismas de la caja:
 *  1. el PERMISO "facturacion.view" abre la pantalla;
 *  2. el ALCANCE del dinero (visibility.ts, recurso "charges") decide si
 *     hay filas. Para DOCENTE y ALUMNO no las hay pase lo que pase — ni
 *     con el permiso encendido a mano.
 *
 * No se inventa un recurso "invoices" en visibility.ts: facturar ES ver
 * dinero, y un segundo recurso que dijera lo mismo solo daría un segundo
 * sitio donde equivocarse (lo explica el encabezado de visibility.ts).
 */
export default async function InstitutoFacturacionPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "facturacion.view")) {
    return (
      <EduDenied
        permission="facturacion.view"
        what="Las facturas del instituto: su estado, su XML y su PDF."
      />
    );
  }

  // 🔴 La segunda cerradura. El permiso puede estar encendido y el alcance
  // seguir siendo "ninguna fila": facturar es dinero.
  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Facturación</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const canEmit = hasEduPermission(permUser, "facturacion.emit");
  const canCancel = hasEduPermission(permUser, "facturacion.cancel");
  const canConfig = hasEduPermission(permUser, "facturacion.config");

  const filters = parseEduInvoiceFilters(searchParams);
  const [page, config] = await Promise.all([
    listEduInvoices(ctx, filters),
    getEduFiscalConfig(ctx),
  ]);

  const cobroParam = searchParams?.cobro;
  const cobroInicial = typeof cobroParam === "string" ? cobroParam : null;

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Facturación</h1>
          <p className="edu-page__lead">
            Se factura sobre un cobro ya emitido y los importes salen de ese cobro tal como se
            cobró. Un cobro no se factura dos veces: para volver a facturarlo hay que cancelar su
            CFDI primero.
          </p>
        </div>
      </header>

      <EduFacturacionScreen
        page={page}
        config={config}
        filtroQ={filters.q}
        filtroEstado={filters.status}
        maxRows={EDU_INVOICE_MAX_ROWS}
        canEmit={canEmit}
        canCancel={canCancel}
        canConfig={canConfig}
        cobroInicial={canEmit ? cobroInicial : null}
      />
    </div>
  );
}

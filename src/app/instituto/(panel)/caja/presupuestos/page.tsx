export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduCampusForCharge } from "@/lib/edu/campus-core";
import {
  EDU_QUOTE_MAX_ROWS,
  listEduQuotesPanel,
  parseEduQuoteFilters,
} from "@/lib/edu/presupuestos";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPresupuestosScreen } from "@/components/edu/dinero/presupuestos-screen";

export const metadata: Metadata = {
  title: "Presupuestos · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/caja/presupuestos — LA FILA 26 DEL COMPARATIVO CON EL DENTAL.
 *
 * DOS CERRADURAS, como toda la caja:
 *  1. el PERMISO `caja.view` abre la pantalla;
 *  2. el ALCANCE del dinero (visibility.ts, recurso "charges") decide si
 *     hay filas. Para DOCENTE y ALUMNO no las hay pase lo que pase — el
 *     alumno que PROPONE el tratamiento no ve su precio, igual que no ve
 *     el cobro ni el saldo.
 *
 * 🔴 El ORIGEN (`https://…`) se lee de las cabeceras EN EL SERVIDOR y
 * viaja como prop: la liga pública que se copia tiene que ser absoluta
 * —se manda por WhatsApp— y armarla en el cliente con `location.origin`
 * la haría distinta en el servidor y en el navegador, que es una
 * discrepancia de hidratación esperando a pasar.
 */
export default async function InstitutoPresupuestosPage({
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
        what="Los presupuestos: lo que se le propone a un paciente, con sus partidas y su vigencia."
      />
    );
  }

  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Presupuestos</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const canCharge = hasEduPermission(permUser, "caja.charge");
  const filters = parseEduQuoteFilters(searchParams);
  const page = await listEduQuotesPanel(ctx, filters);

  // Convertir un presupuesto EMITE un cobro, así que necesita saber en qué
  // mostrador estás: es la misma pregunta —y la misma función— que en Caja.
  const sede = eduCampusForCharge(await getEduCampusScope(ctx));

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Presupuestos</h1>
          <p className="edu-page__lead">
            Lo que se le propone a un paciente antes de cobrarle: partidas del tarifario, descuento,
            vigencia y una liga para que acepte desde su teléfono. Cuando lo acepta, se convierte en
            cobro <strong>con los precios que aceptó</strong>.
          </p>
        </div>
      </header>

      <EduPresupuestosScreen
        page={page}
        maxRows={EDU_QUOTE_MAX_ROWS}
        canCharge={canCharge}
        sedeAviso={sede.reason}
        origin={origin}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduFiscalConfig, getEduFiscalReadiness } from "@/lib/edu/facturacion";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduDatosFiscalesScreen } from "@/components/edu/facturacion/datos-fiscales-screen";

export const metadata: Metadata = {
  title: "Datos fiscales · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/facturacion/datos-fiscales — el RFC del instituto y el
 * interruptor PRUEBAS / EN VIVO.
 *
 * No lleva item de menú propio, igual que el corte de caja: se llega desde
 * la pantalla de Facturación, que es donde uno está cuando descubre que
 * faltan los datos.
 *
 * Exige "facturacion.config", la key que solo lleva DIRECCION por defecto:
 * aquí se decide si la escuela timbra ante el SAT, y eso no es una
 * preferencia de mostrador.
 */
export default async function InstitutoDatosFiscalesPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "facturacion.config")) {
    return (
      <EduDenied
        permission="facturacion.config"
        what="Los datos fiscales del instituto y el interruptor de timbrado en pruebas o en vivo."
      />
    );
  }

  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Datos fiscales</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const [config, readiness] = await Promise.all([
    getEduFiscalConfig(ctx),
    getEduFiscalReadiness(ctx),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Datos fiscales del instituto</h1>
          <p className="edu-page__lead">
            Lo que va como emisor en cada CFDI, y si el instituto timbra en pruebas o ante el SAT.
            Todo el módulo de facturación lee este ambiente: no hay una constante en el código que
            lo decida por su cuenta.
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link className="edu-btn edu-btn--ghost edu-btn--sm" href="/instituto/facturacion">
            Volver a Facturación
          </Link>
        </div>
      </header>

      <EduDatosFiscalesScreen config={config} readiness={readiness} />
    </div>
  );
}

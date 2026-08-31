export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { listEduCampuses } from "@/lib/edu/campus";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduSedesScreen } from "@/components/edu/sedes/sedes-screen";

export const metadata: Metadata = {
  title: "Sedes · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/sedes — las sedes del instituto y quién entra a cada una.
 *
 * EXIGE "sedes.view" AQUÍ, no solo en el menú: esconder el item del sidebar
 * no cierra ninguna puerta, basta con teclear la URL.
 *
 * ⚠️ La LISTA no se recorta por el acceso de quien mira, y es deliberado:
 * quien administra la geografía de la escuela necesita ver el mapa completo,
 * incluidas las sedes a las que él mismo no entra. Lo que el acceso recorta
 * son los DATOS de cada sede —su agenda, sus sillones, su caja—, no su
 * existencia.
 */
export default async function InstitutoSedesPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "sedes.view")) {
    return (
      <EduDenied
        permission="sedes.view"
        what="Las sedes son los edificios del instituto: cada una con sus sillones, su horario y su gente. Aquí se dan de alta y se decide quién entra a cada una."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "sedes.manage");
  const rows = await listEduCampuses(ctx);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Sedes</h1>
          <p className="edu-page__lead">
            Una sede es un edificio de la escuela: el campus norte, el campus sur, la clínica
            de posgrado. Cada una tiene sus <strong>sillones</strong> —y por lo tanto su
            agenda y su caja— y puede estar en otro huso horario. Lo académico no se divide:
            los estudiantes, las generaciones y las especialidades son los mismos en todas, porque
            un estudiante rota entre sedes y su expediente es uno solo.
          </p>
        </div>
      </header>

      <EduSedesScreen
        rows={rows}
        canManage={canManage}
        institutionTimezone={eduSafeTimeZone(ctx.institution.timezone)}
      />
    </div>
  );
}

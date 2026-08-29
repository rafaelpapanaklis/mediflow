export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduChairs } from "@/lib/edu/sillones";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduSillonesScreen } from "@/components/edu/clinica/sillones-screen";

export const metadata: Metadata = {
  title: "Sillones · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/sillones — las unidades dentales y su horario.
 *
 * EXIGE "sillones.view" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL.
 *
 * No hay recorte por visibilidad: un sillón es infraestructura de la
 * escuela, no la fila de nadie. Quien puede verlos los ve todos.
 */
export default async function InstitutoSillonesPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "sillones.view")) {
    return (
      <EduDenied
        permission="sillones.view"
        what="Los sillones son las unidades dentales de la clínica: cuántas hay, cómo se llaman y a qué horas se puede agendar en cada una."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "sillones.manage");
  const rows = await listEduChairs(ctx);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Sillones</h1>
          <p className="edu-page__lead">
            Las unidades dentales de la clínica. Cuántas hay lo decide tu escuela: aquí se
            dan de alta las que existen de verdad, con el número que está pintado en la
            pared, y se les captura el horario en que se puede agendar.
          </p>
        </div>
      </header>

      <EduSillonesScreen rows={rows} canManage={canManage} />
    </div>
  );
}

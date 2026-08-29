export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduFeeSchedules, listEduProcedures } from "@/lib/edu/tarifas";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduProcedimientosScreen } from "@/components/edu/dinero/procedimientos-screen";

export const metadata: Metadata = {
  title: "Procedimientos · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/procedimientos — el catálogo de lo que la clínica hace.
 *
 * EXIGE "tarifarios.view" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL.
 *
 * 🔴 Aquí NO hay precios. El precio es de la LISTA, no del procedimiento,
 * y se captura en /instituto/tarifarios. Un "precio base" en esta pantalla
 * sería el primer paso hacia la segunda columna de precio que esta ola no
 * hace.
 */
export default async function InstitutoProcedimientosPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "tarifarios.view")) {
    return (
      <EduDenied
        permission="tarifarios.view"
        what="El catálogo de procedimientos de la escuela: su clave, su categoría y cuánto dura cada uno en el sillón."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "tarifarios.manage");
  const [rows, schedules] = await Promise.all([
    listEduProcedures(ctx),
    listEduFeeSchedules(ctx),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Procedimientos</h1>
          <p className="edu-page__lead">
            Lo que la clínica hace. El precio no vive aquí: vive en cada lista de precios, para que
            el mismo procedimiento pueda costar distinto según a quién se le cobre.
          </p>
        </div>
      </header>

      <EduProcedimientosScreen
        rows={rows}
        schedulesCount={schedules.filter((s) => s.isActive).length}
        canManage={canManage}
      />
    </div>
  );
}

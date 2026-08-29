export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_MAX_PROCEDURES, getEduTarifario } from "@/lib/edu/tarifas";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduTarifariosScreen } from "@/components/edu/dinero/tarifarios-screen";

export const metadata: Metadata = {
  title: "Tarifarios · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/tarifarios — las listas de precios y la tabla comparativa.
 *
 * 🔴 N LISTAS, NO DOS. Las columnas de la tabla salen de las listas que
 * existan: agregar "Convenio sindicato" no toca ni esta pantalla ni el
 * schema.
 *
 * 🔴 Todo lo que se pinta viene del servidor. Este archivo no calcula ni
 * un precio, y el componente cliente tampoco.
 */
export default async function InstitutoTarifariosPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "tarifarios.view")) {
    return (
      <EduDenied
        permission="tarifarios.view"
        what="Las listas de precios del instituto y el precio de cada procedimiento en cada una."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "tarifarios.manage");
  const tarifario = await getEduTarifario(ctx);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Tarifarios</h1>
          <p className="edu-page__lead">
            {canManage
              ? "Las listas de precios del instituto. Caja no elige la lista: la decide el servidor a partir de quién trajo al paciente."
              : "Las listas de precios del instituto. Puedes consultarlas delante del paciente; cambiarlas es de la dirección."}
          </p>
        </div>
      </header>

      <EduTarifariosScreen
        tarifario={tarifario}
        maxRows={EDU_MAX_PROCEDURES}
        canManage={canManage}
      />
    </div>
  );
}

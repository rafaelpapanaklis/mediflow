export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_MAX_PROCEDURES, getEduTarifario } from "@/lib/edu/tarifas";
import { EDU_VISIBILITY_NONE_DETAIL, eduScopeIsEmpty, eduVisibility } from "@/lib/edu/visibility";
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

  // P2-7 · EL SEGUNDO CANDADO, con salida legible: getEduTarifario ya lanza
  // 403 si el alcance de dinero es "none" (un ALUMNO con tarifarios.view
  // encendido por override), pero desde una página ese throw cae al error
  // boundary genérico. Aquí se comprueba ANTES y se explica — el mismo
  // trato que /instituto/pacientes le da a su alcance.
  if (eduScopeIsEmpty(eduVisibility(ctx, "charges"))) {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Tarifarios</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay precios que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
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
            {/* 🔴 H-10 · ESTE TEXTO DECÍA LO CONTRARIO DE LO QUE PROMETE EL
                RESTO DEL MÓDULO. Las listas de regla automática las decide
                el servidor con un dato que el navegador no controla (quién
                trajo al paciente); las de regla MANUAL —convenios,
                campañas, personal— se eligen a mano al cobrar, que es lo
                que significan desde que se escribió el enum y lo que hasta
                esta ola no pasaba nunca. */}
            {canManage
              ? "Las listas de precios del instituto. Las de regla automática las aplica el servidor a partir de quién trajo al paciente; las de regla «Se elige a mano» (convenios, campañas, personal) las elige caja al cobrar, y la elección gana a la automática."
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

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduChairs } from "@/lib/edu/sillones";
import { getEduCampusScope, listEduCampusOptions } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
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
 * No hay recorte POR PERSONA: un sillón es infraestructura de la escuela,
 * no la fila de nadie. Quien puede verlos los ve todos.
 *
 * 🔴 Ola 11 — lo que SÍ recorta es la SEDE, que es otra pregunta: no "¿de
 * quién es esta fila?" sino "¿en qué edificio está?". Con una sede elegida
 * arriba salen los de esa sede; en la vista consolidada, los de todas las
 * suyas.
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
  const sede = await getEduCampusScope(ctx);
  const cctx = eduWithCampus(ctx, sede);
  const [rows, sedes] = await Promise.all([
    listEduChairs(cctx),
    // Las sedes a las que ENTRA quien mira: son las que puede elegir al dar
    // de alta un sillón. Se piden aparte de `sede.options` porque aquéllas
    // son las del SELECTOR (solo las activas, y solo si hay más de una) y
    // aquí hacen falta todas las suyas para poder mudar un sillón.
    listEduCampusOptions(cctx),
  ]);
  const misSedes = sedes.filter((s) => sede.campusIds === null || sede.campusIds.includes(s.id));

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Sillones</h1>
          <p className="edu-page__lead">
            Las unidades dentales de la clínica. Cuántas hay lo decide tu escuela: aquí se
            dan de alta las que existen de verdad, con el número que está pintado en la
            pared, y se les captura el horario en que se puede agendar.
            {misSedes.length > 1
              ? " El número es único DENTRO de cada sede: el campus norte y el campus sur pueden tener los dos su Sillón 1, porque eso es lo que dice cada pared."
              : ""}
            {sede.active ? ` Estás viendo ${sede.active.name}.` : ""}
          </p>
        </div>
      </header>

      <EduSillonesScreen rows={rows} canManage={canManage} campuses={misSedes} />
    </div>
  );
}

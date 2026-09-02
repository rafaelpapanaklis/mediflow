export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
import { getEduClinicaViva } from "@/lib/edu/clinica-viva";
import { eduLiveFloorVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduVivaScreen } from "@/components/edu/clinica/viva-screen";

export const metadata: Metadata = {
  title: "Clínica en vivo · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/clinica — LOS SILLONES DE LA ESCUELA, AHORA MISMO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ESTADO SALE DE LA CITA, NO DE QUIÉN ESTÁ CONECTADO.
 *
 * El producto no registra presencia y no va a empezar a hacerlo — es la
 * decisión de la Ola 7, escrita en el panel de Dirección. Un sillón está
 * ocupado porque su cita está en IN_CHAIR o IN_PROGRESS. Con presencia, el
 * alumno que cierra el navegador con el paciente todavía en el sillón
 * dejaría la unidad pintada de verde.
 *
 * 🔴 EL MOTOR ES EL DEL DENTAL, IMPORTADO. `src/lib/floor-plan/live-mode.ts`
 * ya sabe decidir libre/próxima/ocupada y sacar la cita activa; se usa tal
 * cual y lo que no encaja se adapta de este lado (IN_CHAIR no existe en el
 * dental). Todo eso vive en src/lib/edu/clinica-viva-core.ts, con su
 * explicación larga.
 *
 * ── LAS DOS CERRADURAS ──────────────────────────────────────────────────
 *  1. el PERMISO "clinica.view" AQUÍ, no solo en el menú. Lo llevan
 *     DIRECCION y DOCENTE; CAJA y el ALUMNO no.
 *  2. el ALCANCE (src/lib/edu/visibility.ts, `eduLiveFloorVisibility`, el
 *     punto único): si devuelve "none" no se pinta nada. Es lo que cierra
 *     el caso de que alguien le encienda la casilla a un alumno por
 *     override — y lo mismo hace el endpoint, para que un GET directo con
 *     su sesión conteste 403.
 *
 * ── LA SEDE ─────────────────────────────────────────────────────────────
 * `?sede=<id>` es el filtro de esta pantalla; sin él manda la sede elegida
 * en la barra superior. Los dos pasan por `getEduCampusScope`, que valida
 * contra el ACCESO de la persona: un id ajeno no amplía nada.
 *
 * ⚠️ Aquí NO hace falta el aviso de "husos distintos" que sí lleva la
 * agenda, y es por la forma de la pantalla: cada tarjeta es UN sitio y
 * pinta su hora en la hora de pared de SU sede. Lo que miente es una
 * rejilla que pone las 9:00 de Tijuana y las 9:00 de Mérida en la misma
 * columna; aquí no hay columna de horas que compartir.
 */
export default async function InstitutoClinicaVivaPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "clinica.view")) {
    return (
      <EduDenied
        permission="clinica.view"
        what="La clínica en vivo: qué sillones están libres, cuáles están por ocuparse y quién está atendiendo en cada uno."
      />
    );
  }

  const crudo = searchParams?.sede;
  const pedida = typeof crudo === "string" ? crudo : Array.isArray(crudo) ? crudo[0] : undefined;
  const sede = await getEduCampusScope(ctx, pedida);

  const scope = eduLiveFloorVisibility(ctx);

  try {
    const board = await getEduClinicaViva(eduWithCampus(ctx, sede));

    return (
      <div className="edu-page edu-page--ancha">
        <header className="edu-pagehead">
          <div>
            <h1 className="edu-page__title">Clínica en vivo</h1>
            <p className="edu-page__lead">
              Un recuadro por sillón, con el número que está pintado en la pared. El color sale
              del estado de la cita —no de quién tenga la pantalla abierta—, así que un paciente
              sentado sigue ocupando su unidad aunque nadie esté mirando. Se actualiza sola.
            </p>
          </div>
        </header>

        {sede.locked && (
          <div className="edu-banner edu-banner--warn" role="status">
            <div>
              <p className="edu-banner__title">Tu cuenta no tiene ninguna sede</p>
              <p className="edu-banner__detail">
                Alguien te dejó marcado en sedes que ya no existen, así que aquí no hay sillones
                que mostrarte. Pídele a la dirección que te dé una sede en Sedes.
              </p>
            </div>
          </div>
        )}

        <EduVivaScreen
          board={board}
          campuses={sede.options.map((c) => ({ id: c.id, name: c.name }))}
          campusActiveId={sede.activeId}
          campusAllLabel={sede.allLabel}
          scopeKind={scope.kind === "all" ? "all" : "supervised"}
        />
      </div>
    );
  } catch (err) {
    // El 403 del alcance no es un fallo: es la respuesta correcta para una
    // cuenta a la que le encendieron el permiso pero no le toca el piso. Se
    // pinta el motivo con las mismas palabras que devuelve el servidor.
    if (err instanceof EduPadronError) {
      return (
        <div className="edu-page">
          <header>
            <h1 className="edu-page__title">Clínica en vivo</h1>
          </header>
          <div className="edu-banner edu-banner--warn" role="alert">
            <div>
              <p className="edu-banner__title">Este tablero no se puede pintar para tu cuenta</p>
              <p className="edu-banner__detail">{err.message}</p>
            </div>
          </div>
        </div>
      );
    }
    throw err;
  }
}

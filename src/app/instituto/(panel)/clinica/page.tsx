export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
import { getEduClinicaViva } from "@/lib/edu/clinica-viva";
import { getEduPlanoSede } from "@/lib/edu/plano";
import { eduLiveFloorVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPlanoScreen } from "@/components/edu/clinica/plano-screen";
import { EduVivaScreen } from "@/components/edu/clinica/viva-screen";

export const metadata: Metadata = {
  title: "Clínica en vivo · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/clinica — EL PLANO DE LA CLÍNICA, EN VIVO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ES EL PISO, NO UNA LISTA. Antes esta pantalla era una tarjeta por
 * sillón; contestaba "¿cuántos quedan libres?" y no contestaba la pregunta
 * que se hace de verdad en el piso clínico: "¿DÓNDE hay uno libre?". Ahora
 * se pinta el PLANO —el mismo mundo 3D del dental, importado entero— con
 * cada sillón en su sitio, y el estudiante y el paciente dibujados en los
 * que están ocupados.
 *
 * 🔴 EL ESTADO SIGUE SALIENDO DE LA CITA, NO DE QUIÉN ESTÁ CONECTADO. Es la
 * decisión de la Ola 7 y esta ola no la reabre: un sillón está ocupado
 * porque su cita está en IN_CHAIR o IN_PROGRESS. Ver clinica-viva-core.ts.
 *
 * ── LAS DOS CERRADURAS ──────────────────────────────────────────────────
 *  1. el PERMISO "clinica.view" AQUÍ, no solo en el menú. Y "clinica.edit"
 *     —una key aparte— para el botón de acomodar el plano.
 *  2. el ALCANCE (src/lib/edu/visibility.ts, `eduLiveFloorVisibility`, el
 *     punto único): si devuelve "none" no se pinta nada. Es lo que cierra
 *     el caso de que alguien le encienda la casilla a un alumno por
 *     override — y lo mismo hacen los endpoints, para que un GET directo
 *     con su sesión conteste 403.
 *
 * ── UN PLANO ES DE UNA SEDE ─────────────────────────────────────────────
 * `?sede=<id>` es el filtro; sin él manda la sede elegida en la barra
 * superior. Los dos pasan por `getEduCampusScope`, que valida contra el
 * ACCESO de la persona. Y como un plano dibuja UN edificio, la vista
 * consolidada no existe aquí: sin sede elegida se pinta la primera a la que
 * esa persona entra, y la pantalla lo dice.
 *
 * ⚠️ Si el instituto todavía no tiene sedes (o falta aplicar
 * sql/edu-ola-11.sql), no hay plano que dibujar y se cae al TABLERO DE
 * TARJETAS de siempre. Es la misma pantalla que había antes de esta ola:
 * degradar a lo anterior es mejor que un hueco con un mensaje técnico.
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
        what="La clínica en vivo: el plano del piso, qué sillones están libres y quién está atendiendo en cada uno."
      />
    );
  }
  const puedeEditar = hasEduPermission(permUser, "clinica.edit");

  const crudo = searchParams?.sede;
  const pedida = typeof crudo === "string" ? crudo : Array.isArray(crudo) ? crudo[0] : undefined;
  const sede = await getEduCampusScope(ctx, pedida);

  const scope = eduLiveFloorVisibility(ctx);
  const scopeKind = scope.kind === "all" ? "all" : "supervised";
  const campuses = sede.options.map((c) => ({ id: c.id, name: c.name }));
  // Un plano dibuja UN edificio: en consolidado se pinta el primero al que
  // esta persona entra (la pantalla lo dice y deja cambiarlo).
  const campusId = sede.activeId ?? sede.options[0]?.id ?? "";

  try {
    if (!campusId) {
      // Sin sedes no hay plano. Se cae al tablero de tarjetas de siempre.
      const board = await getEduClinicaViva(eduWithCampus(ctx, sede));
      return (
        <div className="edu-page edu-page--ancha">
          <header className="edu-pagehead">
            <div>
              <h1 className="edu-page__title">Clínica en vivo</h1>
              <p className="edu-page__lead">
                Un recuadro por sillón, con el número que está pintado en la pared. El plano en
                3D necesita que la escuela tenga al menos una sede dada de alta.
              </p>
            </div>
          </header>
          <EduVivaScreen
            board={board}
            campuses={campuses}
            campusActiveId={sede.activeId}
            campusAllLabel={sede.allLabel}
            scopeKind={scopeKind}
          />
        </div>
      );
    }

    // El plano (guardado o automático) y el estado vivo de ESA sede. Son
    // dos lecturas y no una a propósito: el plano cambia una vez al año y
    // el estado cada veinte segundos — el sondeo del navegador solo vuelve
    // a pedir el segundo.
    const plano = await getEduPlanoSede({ ...ctx, campusIds: sede.campusIds }, campusId);
    const board = await getEduClinicaViva({ ...ctx, campusIds: [campusId] }, new Date(), {
      horario: true,
    });

    return (
      <div className="edu-page edu-page--ancha">
        <header className="edu-pagehead">
          <div>
            <h1 className="edu-page__title">Clínica en vivo</h1>
            <p className="edu-page__lead">
              El piso de {plano.campus.name}, con cada sillón donde está de verdad. En los
              ocupados se dibujan el estudiante y su paciente; haz clic en cualquiera para ver
              quién es y abrir su ficha. El color sale del estado de la cita —no de quién tenga
              la pantalla abierta—, así que un paciente sentado sigue ocupando su unidad aunque
              nadie esté mirando.
            </p>
          </div>
        </header>

        {sede.locked && (
          <div className="edu-banner edu-banner--warn" role="status">
            <div>
              <p className="edu-banner__title">Tu cuenta no tiene ninguna sede</p>
              <p className="edu-banner__detail">
                Alguien te dejó marcado en sedes que ya no existen, así que aquí no hay piso que
                mostrarte. Pídele a la dirección que te dé una sede en Sedes.
              </p>
            </div>
          </div>
        )}

        <EduPlanoScreen
          board={board}
          layout={plano.layout}
          revision={plano.revision}
          campus={plano.campus}
          chairs={plano.chairs}
          campuses={campuses}
          campusActiveId={sede.activeId}
          campusAllLabel={sede.allLabel}
          scopeKind={scopeKind}
          puedeEditar={puedeEditar}
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
              <p className="edu-banner__title">Este plano no se puede pintar para tu cuenta</p>
              <p className="edu-banner__detail">{err.message}</p>
            </div>
          </div>
        </div>
      );
    }
    throw err;
  }
}

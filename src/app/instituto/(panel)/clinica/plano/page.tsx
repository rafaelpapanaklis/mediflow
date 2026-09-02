export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";
import { getEduCampusScope } from "@/lib/edu/campus";
import { getEduPlanoSede } from "@/lib/edu/plano";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPlanoEditor } from "@/components/edu/clinica/plano-editor";

export const metadata: Metadata = {
  title: "Acomodar el plano · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/clinica/plano — ACOMODAR EL PISO DE UNA SEDE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ES OTRA KEY, Y POR ESO ES OTRA PANTALLA. Mirar el piso lo hacen la
 * dirección y los docentes (`clinica.view`); MOVER un sillón de sitio
 * cambia el plano que ven los otros treinta docentes y los ciento veinte
 * estudiantes de la escuela, así que pide `clinica.edit`, que por default
 * solo lleva quien dirige.
 *
 * 🔴 Y ADEMÁS EL ALCANCE, el mismo del tablero (`eduLiveFloorVisibility`,
 * dentro de `getEduPlanoSede`): a un alumno con la casilla encendida a mano
 * esto le contesta 403 igual. Dos cerraduras, como en todo el piso clínico.
 *
 * ── UNA SEDE, NO EL INSTITUTO ───────────────────────────────────────────
 * Cada sede tiene SUS sillones —el número está pintado en SU pared y se
 * repite en las demás— así que se acomoda una por una. `?sede=<id>` manda;
 * sin él, la sede elegida en la barra superior; sin ninguna, la primera a
 * la que esa persona entra.
 */
export default async function InstitutoPlanoEditorPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "clinica.edit")) {
    return (
      <EduDenied
        permission="clinica.edit"
        what="Acomodar el plano de la clínica: dónde está cada sillón en el piso y a qué unidad corresponde."
      />
    );
  }

  const crudo = searchParams?.sede;
  const pedida = typeof crudo === "string" ? crudo : Array.isArray(crudo) ? crudo[0] : undefined;
  const sede = await getEduCampusScope(ctx, pedida);
  const campusId = sede.activeId ?? sede.options[0]?.id ?? "";

  if (!campusId) {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Acomodar el plano</h1>
        </header>
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">Todavía no hay ninguna sede</p>
            <p className="edu-banner__detail">
              Un plano es el piso de UNA sede. Da de alta la primera en Sedes y vuelve aquí.
            </p>
          </div>
        </div>
      </div>
    );
  }

  try {
    const plano = await getEduPlanoSede({ ...ctx, campusIds: sede.campusIds }, campusId);

    return (
      <div className="edu-page edu-page--ancha">
        <header className="edu-pagehead">
          <div>
            <h1 className="edu-page__title">Acomodar el plano</h1>
            <p className="edu-page__lead">
              Pon las paredes, la recepción y las unidades donde están de verdad, y liga cada
              sillón del dibujo con su unidad de esta sede: eso es lo que hace que se pinte en
              vivo. Lo que dibujes aquí es lo que va a ver todo el piso clínico.
            </p>
          </div>
        </header>

        <EduPlanoEditor campus={plano.campus} chairs={plano.chairs} layout={plano.layout} />
      </div>
    );
  } catch (err) {
    if (err instanceof EduPadronError) {
      return (
        <div className="edu-page">
          <header>
            <h1 className="edu-page__title">Acomodar el plano</h1>
          </header>
          <div className="edu-banner edu-banner--warn" role="alert">
            <div>
              <p className="edu-banner__title">Este plano no se puede abrir para tu cuenta</p>
              <p className="edu-banner__detail">{err.message}</p>
            </div>
          </div>
        </div>
      );
    }
    throw err;
  }
}

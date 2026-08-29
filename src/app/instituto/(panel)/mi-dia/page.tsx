export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduFormatDayLong } from "@/lib/edu/agenda-core";
import { listEduToday } from "@/lib/edu/agenda";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduMiDiaScreen } from "@/components/edu/clinica/mi-dia-screen";

export const metadata: Metadata = {
  title: "Mi día · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/mi-dia — lo que ve un alumno al llegar al piso clínico.
 *
 * EXIGE "agenda.view". Es la misma llave que la agenda completa, y sin
 * embargo no enseñan lo mismo: el ALCANCE (src/lib/edu/visibility.ts)
 * recorta las filas por rol. Un alumno ve las suyas, un docente las de sus
 * alumnos VIGENTES y la dirección el día entero.
 *
 * "Hoy" es hoy EN EL INSTITUTO, no en el servidor: si el servidor corre en
 * UTC y la escuela está en Tijuana, entre las cinco de la tarde y la
 * medianoche los dos "hoy" son días distintos, y esta pantalla abriría en
 * el día equivocado justo cuando el turno vespertino la está usando.
 */
export default async function InstitutoMiDiaPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "agenda.view")) {
    return (
      <EduDenied
        permission="agenda.view"
        what="Mi día enseña las citas de hoy: a quién te toca atender, en qué sillón y con qué docente."
      />
    );
  }

  const scope = eduVisibility(ctx, "appointments");
  const now = new Date();
  const tz = ctx.institution.timezone;

  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Mi día</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay citas que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.appointments}</p>
        </div>
      </div>
    );
  }

  const { dayISO, rows } = await listEduToday(ctx, tz, now);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">
            {ctx.user.firstName ? `Hola, ${ctx.user.firstName}` : "Mi día"}
          </h1>
          <p className="edu-page__lead">
            {scope.kind === "own"
              ? "Lo que te toca hoy. Marca aquí cuando el paciente llegue y cuando lo sientes en el sillón."
              : scope.kind === "supervised"
                ? "El día de los alumnos que supervisas hoy."
                : "El día completo de la clínica."}
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link href="/instituto/agenda" className="edu-btn edu-btn--ghost edu-btn--sm">
            Ver la agenda
          </Link>
        </div>
      </header>

      <EduMiDiaScreen rows={rows} dayLabel={eduFormatDayLong(dayISO)} scopeKind={scope.kind} />
    </div>
  );
}

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  eduFormatDayLong,
  eduShiftDayISO,
  eduTodayISO,
  parseEduDayISO,
} from "@/lib/edu/agenda-core";
import { listEduAgenda, listEduToday } from "@/lib/edu/agenda";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduMiDiaScreen } from "@/components/edu/clinica/mi-dia-screen";

export const metadata: Metadata = {
  title: "Mi agenda · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/mi-dia — MI AGENDA: lo que ve un alumno al llegar al piso
 * clínico. Desde la Ola 12 es su pantalla de ENTRADA (el router lo manda
 * aquí, no a Inicio) y gana la vista de SEMANA: un alumno necesita saber
 * qué trae el jueves, no solo lo de esta tarde. La ruta sigue siendo
 * /mi-dia — renombrarla rompería los enlaces guardados.
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
 *
 * ⚠️ Sin filtro por SEDE a propósito (decisión de la Ola 11): el día de
 * una persona es su día completo, ruede por el campus que ruede.
 */
export default async function InstitutoMiDiaPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "agenda.view")) {
    return (
      <EduDenied
        permission="agenda.view"
        what="Mi agenda enseña tus citas: a quién te toca atender, en qué sillón, a qué hora y con qué docente."
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
          <h1 className="edu-page__title">Mi agenda</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay citas que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.appointments}</p>
        </div>
      </div>
    );
  }

  const vistaParam = searchParams?.vista;
  const semana = (Array.isArray(vistaParam) ? vistaParam[0] : vistaParam) === "semana";
  const diaParam = searchParams?.dia;
  const hoyISO = eduTodayISO(tz, now);
  const dayISO =
    parseEduDayISO(Array.isArray(diaParam) ? diaParam[0] : diaParam) ?? hoyISO;

  // La vista de HOY y la de SEMANA usan la MISMA consulta con el MISMO
  // recorte (listEduAgenda): la semana no es una pantalla nueva, es el
  // mismo día siete veces.
  const page = semana
    ? await listEduAgenda(
        ctx,
        {
          view: "semana",
          dayISO,
          chairId: null,
          programId: null,
          studentId: null,
          type: null,
          status: null,
        },
        tz,
        now,
      )
    : null;
  const hoy = semana ? null : await listEduToday(ctx, tz, now);

  const semanaBase = `/instituto/mi-dia?vista=semana`;

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">
            {ctx.user.firstName ? `Hola, ${ctx.user.firstName}` : "Mi agenda"}
          </h1>
          <p className="edu-page__lead">
            {scope.kind === "own"
              ? semana
                ? "Tu semana: qué paciente traes cada día, en qué sillón y con qué docente."
                : "Lo que te toca hoy. Marca aquí cuando el paciente llegue y cuando lo sientes en el sillón."
              : scope.kind === "supervised"
                ? semana
                  ? "La semana de los alumnos que supervisas."
                  : "El día de los alumnos que supervisas hoy."
                : semana
                  ? "La semana completa de la clínica."
                  : "El día completo de la clínica."}
          </p>
        </div>
        <div className="edu-pagehead__actions">
          {/* El toggle Hoy | Semana son ENLACES, no un useState: se puede
              compartir "mi semana" y sobrevive al refresh del teléfono. */}
          <Link
            href="/instituto/mi-dia"
            className={`edu-btn edu-btn--sm ${semana ? "edu-btn--ghost" : "edu-btn--primary"}`}
            aria-current={semana ? undefined : "page"}
          >
            Hoy
          </Link>
          <Link
            href={semanaBase}
            className={`edu-btn edu-btn--sm ${semana ? "edu-btn--primary" : "edu-btn--ghost"}`}
            aria-current={semana ? "page" : undefined}
          >
            Semana
          </Link>
        </div>
      </header>

      {semana && (
        <div className="edu-pagehead__actions" style={{ marginBottom: 10 }}>
          <Link
            href={`${semanaBase}&dia=${eduShiftDayISO(dayISO, -7)}`}
            className="edu-btn edu-btn--ghost edu-btn--sm"
          >
            ← Semana anterior
          </Link>
          {dayISO !== hoyISO && (
            <Link href={semanaBase} className="edu-btn edu-btn--ghost edu-btn--sm">
              Esta semana
            </Link>
          )}
          <Link
            href={`${semanaBase}&dia=${eduShiftDayISO(dayISO, 7)}`}
            className="edu-btn edu-btn--ghost edu-btn--sm"
          >
            Semana siguiente →
          </Link>
        </div>
      )}

      <EduMiDiaScreen
        rows={semana ? page!.rows : hoy!.rows}
        dayLabel={semana ? "" : eduFormatDayLong(hoy!.dayISO)}
        scopeKind={scope.kind}
        vista={semana ? "semana" : "hoy"}
        days={semana ? page!.days : []}
        hoyISO={hoyISO}
        truncated={semana ? page!.truncated : false}
      />
    </div>
  );
}

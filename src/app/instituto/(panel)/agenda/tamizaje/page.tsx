export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  listEduPendingScreenings,
  listEduStudentOptions,
  listEduSupervisorOptions,
} from "@/lib/edu/agenda";
import { listEduPatientOptions } from "@/lib/edu/pacientes";
import { listEduPrograms } from "@/lib/edu/padron";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduTamizajeScreen } from "@/components/edu/clinica/tamizaje-screen";

export const metadata: Metadata = {
  title: "Tamizaje · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/agenda/tamizaje — la valoración inicial.
 *
 * EXIGE "casos.assign", no "agenda.view": esta pantalla no muestra la
 * agenda, ASIGNA pacientes a alumnos y abre casos. Es la decisión académica
 * de la ola y por eso es de la dirección y de los docentes.
 *
 * No tiene entrada propia en el menú a propósito: se llega desde la Agenda,
 * que es donde está la persona cuando el paciente llega a valoración. El
 * sidebar marca activo el item cuyo href coincide más, así que estando aquí
 * sigue encendido "Agenda".
 */
export default async function InstitutoTamizajePage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "casos.assign")) {
    return (
      <EduDenied
        permission="casos.assign"
        what="El tamizaje es la valoración inicial: decide a qué alumno se le asigna el paciente y abre su caso clínico."
      />
    );
  }

  const now = new Date();
  const tz = ctx.institution.timezone;

  const [pendientes, pacientes, alumnos, docentes, programas] = await Promise.all([
    listEduPendingScreenings(ctx, tz, now),
    listEduPatientOptions(ctx, now),
    listEduStudentOptions(ctx, now),
    listEduSupervisorOptions(ctx),
    listEduPrograms(ctx),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Tamizaje</h1>
          <p className="edu-page__lead">
            La valoración inicial. Aquí el paciente deja de ser &quot;el señor que
            llegó&quot; y pasa a ser el caso de alguien: se le asigna un alumno, una
            especialidad y un docente responsable.
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link href="/instituto/agenda" className="edu-btn edu-btn--ghost edu-btn--sm">
            Volver a la agenda
          </Link>
        </div>
      </header>

      <EduTamizajeScreen
        pendientes={pendientes}
        patients={pacientes.map((p) => ({
          id: p.id,
          folio: p.folio,
          name: p.name,
          status: p.status,
        }))}
        students={alumnos}
        supervisors={docentes}
        programs={programas
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.name, code: p.code }))}
      />
    </div>
  );
}

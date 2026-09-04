export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission, type EduPermissionKey } from "@/lib/edu/permissions";
import { getEduEstudianteFicha } from "@/lib/edu/estudiante";
import { EDU_STUDENT_STATUS_LABELS } from "@/lib/edu/types";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacienteTabs, type EduPacienteTab } from "@/components/edu/expediente/paciente-tabs";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

export const metadata: Metadata = {
  title: "Estudiante · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * Shell de la ficha de UN estudiante: encabezado + pestañas.
 *
 * Es un LAYOUT y no un encabezado repetido, por lo mismo que la ficha del
 * paciente: Next conserva el layout al navegar entre rutas hermanas, así que
 * cambiar de pestaña NO vuelve a consultar al alumno ni a recontar sus KPIs.
 * Con el encabezado dentro de cada página serían cuatro consultas para mirar
 * cuatro pestañas de la misma persona.
 *
 * 🔴 EL ALUMNO SE BUSCA DENTRO DEL ALCANCE (getEduEstudianteFicha, que usa
 * eduPadronScope). El id de la URL no basta: uno de otra escuela —o de un
 * alumno que no supervisas— da 404, exactamente igual que uno que no existe.
 * Un 403 confirmaría que esa matrícula existe en esta escuela.
 *
 * ⚠️ Este layout exige "padron.view" y NADA más. Cada pestaña vuelve a
 * exigir la suya (pacientes.view, agenda.view, casos.view): la lista de
 * pestañas filtrada es una comodidad visual, no un candado. Esconder una
 * pestaña no cierra ninguna puerta — basta con teclear la URL.
 *
 * Consecuencia de eduPadronScope, buscada: CAJA no abre esta ficha (cobra,
 * no inscribe) y un ALUMNO tampoco abre la suya — su avance lo ve en su
 * bitácora, que es otra pantalla con otro alcance.
 */
export default async function InstitutoEstudianteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "padron.view")) {
    return (
      <EduDenied
        permission="padron.view"
        what="La ficha de un estudiante: quién es, a qué pacientes ha atendido, su agenda y sus casos."
      />
    );
  }

  const alumno = await getEduEstudianteFicha(
    ctx,
    params.id,
    ctx.institution.timezone,
  );
  if (!alumno) notFound();

  const base = `/instituto/estudiantes/${alumno.id}`;
  const titular = alumno.supervisors.find((s) => s.isPrimary) ?? alumno.supervisors[0] ?? null;

  const definicion: {
    key: string;
    href: string;
    label: string;
    permission: EduPermissionKey | null;
  }[] = [
    { key: "resumen", href: base, label: "Resumen", permission: null },
    // 🔴 ESTE es el recorrido que pidió Rafael: del nombre de un estudiante
    // a los pacientes que ha atendido, y de ahí al expediente de cada uno.
    { key: "pacientes", href: `${base}/pacientes`, label: "Pacientes", permission: "pacientes.view" },
    { key: "agenda", href: `${base}/agenda`, label: "Agenda", permission: "agenda.view" },
    { key: "casos", href: `${base}/casos`, label: "Casos", permission: "casos.view" },
  ];

  const tabs: EduPacienteTab[] = definicion
    .filter((t) => t.permission === null || hasEduPermission(permUser, t.permission))
    .map(({ key, href, label }) => ({ key, href, label }));

  const veBitacora = hasEduPermission(permUser, "evaluacion.view");

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/padron" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Estudiantes
        </Link>
        {veBitacora && (
          <Link
            href={`/instituto/evaluacion/${alumno.id}`}
            className="edu-btn edu-btn--ghost edu-btn--sm"
          >
            <BookOpen size={15} />
            Bitácora académica
          </Link>
        )}
      </p>

      <header className="edu-fichahead">
        <div>
          <span className="edu-fichahead__folio">{alumno.matricula}</span>
          <h1 className="edu-fichahead__name">{alumno.name}</h1>
          <p className="edu-fichahead__meta">
            {[
              alumno.programName,
              alumno.cohortName,
              `Semestre ${alumno.semester}`,
              EDU_STUDENT_STATUS_LABELS[alumno.status],
              !alumno.userIsActive ? "Cuenta desactivada" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {titular && (
              <>
                {" · "}
                {/* El titular VIGENTE, clicable a su ficha. El id es el de
                    EduUser: un docente no tiene fila en EduStudent. */}
                <EduPersonaLink kind="docente" id={titular.supervisorUserId}>
                  {titular.name}
                </EduPersonaLink>
                {titular.isPrimary ? " (titular)" : ""}
              </>
            )}
            {!titular && " · Sin docente asignado"}
          </p>
        </div>
      </header>

      <EduPacienteTabs tabs={tabs} ariaLabel="Secciones del estudiante" />

      {children}
    </div>
  );
}

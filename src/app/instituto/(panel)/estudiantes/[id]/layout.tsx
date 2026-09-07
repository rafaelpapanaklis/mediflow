export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CalendarRange,
  ClipboardList,
  GraduationCap,
  Layers,
  UserCheck,
} from "lucide-react";
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

/** El tono de la píldora del estado ACADÉMICO. Los mismos `.edu-tag--*` de
 *  siempre, cuyos contrastes ya están medidos; aquí solo se reparten. */
const ESTADO_TONO: Record<string, string> = {
  ACTIVE: "edu-tag--ok",
  ON_LEAVE: "edu-tag--warn",
  GRADUATED: "edu-tag--info",
  WITHDRAWN: "edu-tag--muted",
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

  // Las iniciales del recuadro, con el mismo cálculo que la ficha del
  // paciente y que el avatar de la sesión: dos letras como mucho, y si el
  // nombre viene en una sola pieza, la primera de esa pieza.
  const iniciales =
    alumno.name
      .split(/\s+/)
      .filter(Boolean)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || alumno.name.charAt(0).toUpperCase();

  // `casosAbiertos` es `number | null`, y null NO es cero: null significa
  // "a quien mira no le toca el recurso clínico" (caja). Pintar un 0 ahí
  // sería mentir sobre la carga de este alumno.
  const casosAbiertos = alumno.kpis.casosAbiertos;

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

      {/* ── LA CABECERA DE LA FICHA ────────────────────────────────────
          La misma que la del paciente (`.edu-fichahero`, Ola B). Antes era
          `.edu-fichahead`: una tarjeta blanca lisa con el nombre a 19 px
          —más chico que el título de la lista de la que vienes, que mide
          27— y con programa, generación, semestre, estado y docente unidos
          por `.join(" · ")` en UNA línea gris de 13 px. El docente
          asignado, que es a lo que se entra, pesaba lo mismo que el
          semestre.

          Ahora: banda de marca, iniciales, nombre grande y los datos clave
          como píldoras. Apilado por defecto y en fila con `@container`,
          igual que el paciente: la fila se estrena cuando la CABECERA se ha
          medido a sí misma, no cuando la ventana pasa un número.

          🔴 EL RECUADRO NO ES UNA FOTO, son las INICIALES: este vertical no
          guarda la cara de nadie. */}
      <header className="edu-fichahero">
        <div className="edu-fichahero__main">
          <span className="edu-fichahero__avatar" aria-hidden="true">
            {iniciales}
          </span>

          <div className="edu-fichahero__info">
            <span className="edu-fichahero__folio">Matrícula {alumno.matricula}</span>
            <h1 className="edu-fichahero__name">{alumno.name}</h1>
            <span className="edu-fichahero__estado">
              <span className={`edu-tag ${ESTADO_TONO[alumno.status] ?? "edu-tag--muted"}`}>
                {EDU_STUDENT_STATUS_LABELS[alumno.status]}
              </span>
              {/* La CUENTA y el estado ACADÉMICO son dos cosas distintas:
                  un alumno ACTIVO con la cuenta desactivada no puede entrar,
                  y fundir las dos en una sola etiqueta esconde justo el
                  caso que hay que atender. */}
              {!alumno.userIsActive && (
                <span className="edu-tag edu-tag--danger">Cuenta desactivada</span>
              )}
            </span>
          </div>

          <div className="edu-fichahero__datos">
            <span className="edu-fichadato">
              <GraduationCap size={13} strokeWidth={1.9} aria-hidden />
              {alumno.programName}
            </span>

            <span className="edu-fichadato">
              <CalendarRange size={13} strokeWidth={1.9} aria-hidden />
              {alumno.cohortName}
            </span>

            <span className="edu-fichadato">
              <Layers size={13} strokeWidth={1.9} aria-hidden />
              {alumno.semester}º semestre
            </span>

            {/* El titular VIGENTE, clicable a su ficha. El id es el de
                EduUser: un docente no tiene fila en EduStudent. */}
            {titular ? (
              <span className="edu-fichadato">
                <UserCheck size={13} strokeWidth={1.9} aria-hidden />
                <EduPersonaLink kind="docente" id={titular.supervisorUserId}>
                  {titular.name}
                </EduPersonaLink>
                {titular.isPrimary ? " (titular)" : ""}
              </span>
            ) : (
              <span className="edu-fichadato">
                <UserCheck size={13} strokeWidth={1.9} aria-hidden />
                Sin docente asignado
              </span>
            )}

            {casosAbiertos !== null && (
              <span className="edu-fichadato">
                <ClipboardList size={13} strokeWidth={1.9} aria-hidden />
                {`${casosAbiertos} caso${casosAbiertos === 1 ? "" : "s"} abierto${
                  casosAbiertos === 1 ? "" : "s"
                }`}
              </span>
            )}
          </div>
        </div>
      </header>

      <EduPacienteTabs tabs={tabs} ariaLabel="Secciones del estudiante" />

      {children}
    </div>
  );
}

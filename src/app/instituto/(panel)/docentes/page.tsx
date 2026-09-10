export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduCurrentAssignments, listEduTeachers } from "@/lib/edu/padron";
import { listEduRotacionesProgramadas } from "@/lib/edu/docente";
import { listEduStudentOptions, listEduSupervisorOptions } from "@/lib/edu/agenda";
import { eduPadronScope } from "@/lib/edu/padron-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduDocentesScreen } from "@/components/edu/padron/docentes-screen";
import { EduRotacionProgramadaPanel } from "./rotacion-programada";

export const metadata: Metadata = {
  title: "Docentes · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/docentes — la lista de docentes y su carga de hoy.
 *
 * EXIGE "docentes.view". Los docentes lo tienen por defecto: saber con
 * quién se comparte el piso clínico es parte del trabajo, no un privilegio
 * de la dirección.
 *
 * El número de alumnos es de HOY (asignaciones vigentes). Ese matiz es
 * TODO: un conteo sin vigencia suma las generaciones que ese docente
 * entregó hace años y la dirección reparte la carga con un dato falso.
 */
export default async function InstitutoDocentesPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "docentes.view")) {
    return (
      <EduDenied
        permission="docentes.view"
        what="Aquí se ve quién da clase en el instituto y cuántos estudiantes supervisa cada quien."
      />
    );
  }

  const canAssign = hasEduPermission(permUser, "supervision.assign");

  // Un solo `now` para las dos consultas: si cada una llamara a new Date(),
  // el conteo y la lista podrían discrepar sobre una asignación cerrada
  // entre una y otra.
  const now = new Date();

  // 🔴 P1-4 DE LA AUDITORÍA — LA LISTA NOMINAL SE RECORTA CON EL MISMO
  // ALCANCE DEL PADRÓN.
  //
  // `listEduCurrentAssignments` sin el tercer parámetro devuelve TODAS las
  // asignaciones vigentes del instituto, con el id, la matrícula y el
  // nombre de cada alumno — así que cualquier DOCENTE veía por nombre a los
  // alumnos de todos sus colegas, que es exactamente lo que
  // `eduPadronScope` existe para impedir ("un DOCENTE ve SOLO sus alumnos").
  // Y de esos ids salían los que hacían trivial el P0-1.
  //
  // El alcance se pide al helper del padrón y no se escribe a mano aquí: un
  // `if (role !== "DIRECCION")` suelto es una segunda regla que el día que
  // aparezca un rol nuevo dirá algo distinto de la primera.
  //
  // ⚠️ El CONTEO agregado de arriba (`listEduTeachers`) NO se toca y no es
  // un descuido: "cuántos alumnos lleva cada quien hoy" es para lo que
  // existe esta pantalla y es un número, no una identidad.
  const alcance = eduPadronScope(ctx);
  const [docentes, asignaciones, rotaciones, alumnos, docentesOpciones] = await Promise.all([
    listEduTeachers(ctx, now),
    alcance.kind === "all"
      ? listEduCurrentAssignments(ctx, now)
      : alcance.kind === "supervised"
        ? listEduCurrentAssignments(ctx, now, alcance.supervisorUserId)
        : Promise.resolve([]),
    // 🔴 OLA C·2 · LO QUE YA ESTÁ PROGRAMADO. Se recorta con el MISMO
    // alcance del padrón que la lista nominal de arriba: de aquí salen la
    // matrícula y el nombre de cada alumno.
    listEduRotacionesProgramadas(ctx, now),
    // Los desplegables del alta solo viajan a quien va a poder usarlos: sin
    // este guard, el navegador de un docente recibiría la lista de alumnos
    // a los que no le toca repartir (es el P1-4 de la auditoría, aplicado
    // aquí desde el primer día).
    canAssign ? listEduStudentOptions(ctx, now) : Promise.resolve([]),
    canAssign ? listEduSupervisorOptions(ctx) : Promise.resolve([]),
  ]);

  const total = docentes.reduce((n, d) => n + d.currentStudents, 0);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Docentes</h1>
          <p className="edu-page__lead">
            {docentes.length} {docentes.length === 1 ? "docente" : "docentes"} y {total}{" "}
            {total === 1 ? "supervisión vigente" : "supervisiones vigentes"}. El conteo es de hoy:
            las asignaciones cerradas siguen en el historial, pero no suman aquí.
          </p>
        </div>
      </header>

      <EduDocentesScreen teachers={docentes} assignments={asignaciones} canAssign={canAssign} />

      {/* 🔴 OLA C·2 · LA ROTACIÓN PROGRAMADA, en la misma pantalla que el
          reparto de hoy. Cero SQL: `startsAt` existe desde la Ola 1A y el
          predicado de vigencia ya lo respeta; lo que faltaba era escribir
          una fecha futura y poder VER lo programado antes de que llegue. */}
      <EduRotacionProgramadaPanel
        rows={rotaciones}
        students={alumnos.map((a) => ({
          id: a.id,
          matricula: a.matricula,
          name: a.name,
          programName: a.programName,
        }))}
        teachers={docentesOpciones.map((d) => ({ id: d.id, name: d.name }))}
        canAssign={canAssign}
        timezone={ctx.institution.timezone}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { eduPatientEditAbilities, hasEduPermission } from "@/lib/edu/permissions";
import { EDU_PATIENT_PAGE_SIZE, parseEduPatientFilters } from "@/lib/edu/pacientes-core";
import { listEduPatients } from "@/lib/edu/pacientes";
import { listEduStudentOptions } from "@/lib/edu/agenda";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import Link from "next/link";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacientesScreen } from "@/components/edu/clinica/pacientes-screen";

export const metadata: Metadata = {
  title: "Pacientes · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/pacientes — los pacientes de la clínica de la escuela.
 *
 * EXIGE "pacientes.view" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL.
 *
 * 🔴 EL RECORTE SE HACE EN EL SERVIDOR, con el helper único de
 * src/lib/edu/visibility.ts. `listEduPatients` resuelve el alcance por su
 * cuenta y el componente cliente no tiene forma de pedir más filas: recibe
 * las que le tocan y punto. Si el recorte viviera en el navegador, sería
 * una cortina, no un muro.
 */
export default async function InstitutoPacientesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "pacientes.view")) {
    return (
      <EduDenied
        permission="pacientes.view"
        what="Los pacientes de la clínica: su folio, su contacto, en qué estado están y quién los trajo."
      />
    );
  }

  // 🔴 DOS LLAVES Y TRES GRUPOS para la ficha (H-02 + Ola B), resueltos en
  // el punto único: `manage` abre la identidad y el papeleo (caja,
  // dirección), `contacto` abre los teléfonos, el correo y la preferencia
  // también al alumno y al docente —que son quienes tienen al paciente
  // delante—, y `clinico` abre los NOM-004, los hábitos, el embarazo y la
  // dentición con la misma llave que los antecedentes. El endpoint las
  // vuelve a exigir.
  const {
    manage: canManage,
    contacto: canContacto,
    clinico: canClinico,
  } = eduPatientEditAbilities(permUser);
  const canOrigin = hasEduPermission(permUser, "pacientes.origen");
  const scope = eduVisibility(ctx, "patients");

  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Pacientes</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay pacientes que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.patients}</p>
        </div>
      </div>
    );
  }

  // Un solo `now` para TODAS las consultas de esta pantalla: si cada una
  // llamara a new Date(), dos podrían discrepar sobre si una asignación que
  // acaba de cerrarse sigue vigente.
  const now = new Date();
  const filters = parseEduPatientFilters(searchParams);

  const [page, alumnos] = await Promise.all([
    listEduPatients(ctx, filters, now),
    // 🔴 CIERRE · era el último sitio donde la lista completa de alumnos
    // viajaba al navegador (la auditoría lo dejó anotado en el P1-4: aquí
    // alimenta el filtro VISIBLE "¿lo trajo algún alumno?" y recortarla era
    // una decisión de producto). La decisión quedó tomada y vive DENTRO de
    // listEduStudentOptions (agenda.ts), no en esta página: un alumno se ve
    // solo a sí mismo, un docente a sus alumnos vigentes, caja y dirección
    // a todos. El filtro sigue funcionando igual para quien agenda; al
    // alumno le ofrece su única opción legítima: "los que traje yo".
    listEduStudentOptions(ctx, now),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Pacientes</h1>
          <p className="edu-page__lead">
            {scope.kind === "all"
              ? "Todos los pacientes de la clínica. Quién trajo a cada uno se marca aquí, y de ese dato depende la tarifa que le pone caja."
              : scope.kind === "own"
                ? "Los pacientes que atiendes: los de tus casos y los de tus citas."
                : "Los pacientes de los estudiantes que supervisas hoy. Cuando la dirección te asigne o te quite alguno, esta lista lo refleja sola."}
          </p>
        </div>

        {/* ── OLA C·2 · LAS DOS PANTALLAS DE DIRECCIÓN ────────────────────
            🔴 ESTA LISTA YA NO ENSEÑA LAS FICHAS DADAS DE BAJA, y ése es
            justo el derecho ARCO: salen del listado y del buscador. Sin
            una puerta a ellas, una baja no se podría deshacer nunca y
            «¿anonimizaron a fulano?» solo se contestaría en Postgres.

            🔴 Y LA BITÁCORA (NOM-024) cuelga de aquí y no del menú: la
            entrada del sidebar vive en `EDU_NAV_ITEMS` (src/lib/edu/types.ts),
            que es un archivo COMPARTIDO fuera del área de esta casilla.
            Queda escrito en el punto 6 del reporte; mientras tanto se
            llega desde donde se pregunta —la lista de pacientes— y desde
            la ficha, que es donde alguien se hace la pregunta.

            Las dos piden `direccion.panel`; la primera, además,
            `pacientes.manage`. El servidor las vuelve a exigir. */}
        {hasEduPermission(permUser, "direccion.panel") && (
          <div className="edu-pagehead__actions">
            {hasEduPermission(permUser, "pacientes.manage") && (
              <Link
                href="/instituto/pacientes/arco"
                className="edu-btn edu-btn--ghost edu-btn--sm"
              >
                Fichas fuera de la lista
              </Link>
            )}
            <Link
              href="/instituto/direccion/bitacora"
              className="edu-btn edu-btn--ghost edu-btn--sm"
            >
              Bitácora
            </Link>
          </div>
        )}
      </header>

      <EduPacientesScreen
        rows={page.rows}
        /* 🔴 H-06 · el cursor de la PÁGINA SIGUIENTE. La primera página la
           pinta el servidor; «Ver más» pide la siguiente al endpoint y la
           apila. El tope de 300 sin salida desapareció de aquí. */
        nextCursor={page.nextCursor}
        maxRows={EDU_PATIENT_PAGE_SIZE}
        filters={filters}
        students={alumnos}
        canManage={canManage}
        canContacto={canContacto}
        canClinico={canClinico}
        canOrigin={canOrigin}
        /* 🔴 H-29 · el alcance de un docente es "supervised" y NUNCA
           "none", así que la rama de arriba no lo atrapa y la lista vacía
           le decía «Todavía no hay pacientes» — mintiéndole sobre el estado
           del sistema. `listEduStudentOptions` ya le devuelve SUS alumnos
           vigentes: cero significa exactamente "todavía no te asignaron a
           nadie", y eso es lo que la pantalla tiene que decir. */
        sinAlumnosAsignados={scope.kind === "supervised" && alumnos.length === 0}
        /* 🔴 H-07 · un alumno EGRESADO ya no alcanza a sus pacientes, y su
           alcance sigue siendo "own": sin esto leería el vacío genérico.
           `listEduStudentOptions` filtra por `status: "ACTIVE"`, así que
           para un alumno devuelve UNA fila (la suya) si sigue inscrito y
           NINGUNA si egresó, se dio de baja o está en pausa. Cero es
           exactamente "tu inscripción no está activa", sin una consulta
           más. */
        inscripcionInactiva={scope.kind === "own" && alumnos.length === 0}
        /* 🔴 H-05 · LAS DOS LLAVES DE ARCO, resueltas aquí. Fusionar mueve
           el expediente de una persona a otra ficha: `pacientes.manage` lo
           lleva CAJA por defecto y eso no es una decisión de mostrador. Con
           las dos, solo DIRECCIÓN — y sin inventar ninguna key nueva, que
           no le llegaría a nadie con `permissionsOverride` guardado. La
           capa de datos las vuelve a exigir. */
        canArco={
          hasEduPermission(permUser, "pacientes.manage") &&
          hasEduPermission(permUser, "direccion.panel")
        }
      />
    </div>
  );
}

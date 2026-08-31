export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { listEduPatientCases } from "@/lib/edu/casos";
import { listEduPatientAppointments, listEduStudentOptions } from "@/lib/edu/agenda";
import { listEduCurrentAssignments } from "@/lib/edu/padron";
import { eduFormatDayShort } from "@/lib/edu/agenda-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { getEduCaseApprovalState } from "@/lib/edu/autorizaciones";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_CASE_CLOSED_STATUSES,
  EDU_CASE_STATUS_LABELS,
} from "@/lib/edu/types";
import { listEduProcedures } from "@/lib/edu/tarifas";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCasoAutorizaciones } from "@/components/edu/autorizaciones/caso-autorizaciones";
import { EduCasoAcciones } from "@/components/edu/casos/caso-acciones";
import { EduCasoProcedimiento } from "@/components/edu/evaluacion/caso-procedimiento";
import { EduCasoRecetas } from "@/components/edu/recetas/caso-recetas";
import { listEduCaseRecetas } from "@/lib/edu/recetas";

/**
 * Pestaña CASOS: los casos del paciente y sus últimas citas.
 *
 * 🔴 CAJA NO LLEGA AQUÍ. No por la pestaña escondida (eso no cierra nada)
 * sino por el permiso `casos.view`, que caja no tiene, y por el ALCANCE:
 * `listEduPatientCases` usa el recurso "cases", que para caja es "none" y
 * devuelve la lista vacía aunque alguien le encienda el interruptor.
 *
 * ⚠️ Lo que se ve aquí NO es "todos los casos del paciente": es el recorte
 * de quien pregunta. La señora con endodoncia y ortodoncia tiene dos casos,
 * dos alumnos y dos docentes; el de endodoncia ve UNO. Que pueda abrir la
 * ficha del paciente no le da el expediente completo — y la pantalla lo
 * dice, en vez de fingir que ese es todo el historial.
 */
export default async function PacienteCasosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "casos.view")) {
    return (
      <EduDenied
        permission="casos.view"
        what="Los casos clínicos del paciente: qué especialidad, qué alumno y en qué van."
      />
    );
  }

  const p = await getEduPatient(ctx, params.id);
  if (!p) notFound();

  const scope = eduVisibility(ctx, "cases");

  // ── Ola de Casos · qué puede HACER quien mira, derivado en el server ──
  // Mover el estado es del MISMO permiso que el PATCH (casos.assign);
  // registrar sesión, del expediente; traspasar y firmar, de los suyos. A
  // nadie se le pinta un botón que va a rebotar con 403.
  const canMoverEstado = hasEduPermission(permUser, "casos.assign");
  const canRegistrarSesion = hasEduPermission(permUser, "expediente.write");
  const canTraspasar = hasEduPermission(permUser, "traspaso.manage");
  const canFirmar = hasEduPermission(permUser, "autorizaciones.decide");

  const [casos, citas, alumnosDestino] = await Promise.all([
    listEduPatientCases(ctx, p.id),
    hasEduPermission(permUser, "agenda.view")
      ? listEduPatientAppointments(ctx, p.id, ctx.institution.timezone)
      : Promise.resolve([]),
    // El destino del traspaso, por ALCANCE (la lección del P1-4: el padrón
    // completo no viaja al navegador de quien no lo ve): un DOCENTE recibe
    // SOLO sus alumnos vigentes; dirección, los activos del instituto.
    canTraspasar
      ? scope.kind === "all"
        ? listEduStudentOptions(ctx).then((rows) =>
            rows.map((a) => ({ id: a.id, matricula: a.matricula, name: a.name })),
          )
        : listEduCurrentAssignments(ctx, new Date(), ctx.eduUserId).then((rows) =>
            rows.map((a) => ({ id: a.studentId, matricula: a.matricula, name: a.name })),
          )
      : Promise.resolve([]),
  ]);

  // ── Ola 4 · el estado de autorización de CADA caso ───────────────────
  // Se pide en paralelo y solo si esta persona ve autorizaciones. Un
  // paciente tiene dos o tres casos como mucho (uno por especialidad), así
  // que son dos o tres consultas y no una lista sin fondo; el desplegable
  // de "qué mando" NO se carga aquí — lo pide el modal cuando se abre.
  const veAutorizaciones = hasEduPermission(permUser, "autorizaciones.view");
  const puedePedir = hasEduPermission(permUser, "autorizaciones.request");
  const autorizaciones = veAutorizaciones
    ? await Promise.all(
        casos.map((c) => getEduCaseApprovalState(ctx, c.id, ctx.institution.timezone)),
      )
    : [];

  // ── Ola 6 · el procedimiento principal del caso ──────────────────────
  // 🔴 Es el único dato que la evaluación le pide al piso clínico, y sin
  // él un requisito por procedimiento cuenta CERO para siempre.
  //
  // ⚠️ El catálogo se carga aunque quien mira no tenga "tarifarios.view",
  // y eso NO abre el dinero: EduProcedure guarda nombre, clave, categoría
  // y duración — el precio vive en la lista de precios
  // (EduFeeScheduleItem), que sigue cerrada. Un docente necesita los
  // nombres para clasificar el caso; los precios, no.
  //
  // Solo lo carga quien puede EDITAR: para el resto la pantalla pinta el
  // nombre que ya viene en la fila del caso y no hace una consulta de más.
  const puedeClasificar = hasEduPermission(permUser, "casos.assign");
  const procedimientos = puedeClasificar
    ? await listEduProcedures(ctx, { soloActivos: true })
    : [];

  // ── Ola 14 · las recetas de CADA caso ────────────────────────────────
  // Mismo trato que las autorizaciones de arriba: dos o tres consultas en
  // paralelo (un paciente tiene un caso por especialidad), solo para quien
  // puede verlas. Aquí solo se LISTAN — proponer y anular viven en la
  // pestaña Recetas, a donde lleva el enlace del bloque.
  const veRecetas = hasEduPermission(permUser, "recetas.view");
  const recetasPorCaso = veRecetas
    ? await Promise.all(casos.map((c) => listEduCaseRecetas(ctx, c.id, ctx.institution.timezone)))
    : [];

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Casos</h2>
          <span className="edu-count">{casos.length}</span>
        </div>

        {scope.kind !== "all" && casos.length > 0 && (
          <p className="edu-note">
            Ves los casos que te tocan. Si este paciente tiene otros con otra especialidad y otro
            alumno, no salen aquí.
          </p>
        )}

        {casos.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin casos que mostrarte</p>
            <p className="edu-empty__detail">
              Un caso se abre en el tamizaje: es lo que le pone alumno y especialidad al paciente. Si
              este paciente ya tiene casos con otros alumnos, no te tocan.
            </p>
          </div>
        ) : (
          <div className="edu-stack edu-stack--tight">
            {casos.map((c, i) => {
              const cerrado = (EDU_CASE_CLOSED_STATUSES as string[]).includes(c.status);
              const auth = autorizaciones[i] ?? null;
              return (
                <div key={c.id} className={`edu-nota ${cerrado ? "edu-nota--borrador" : ""}`}>
                  <div className="edu-nota__head">
                    <div>
                      <span className="edu-nota__when">{c.programName}</span>
                      <span className="edu-nota__who">
                        {c.studentMatricula} · {c.studentName}
                        {c.supervisorName ? ` · supervisa ${c.supervisorName}` : ""}
                      </span>
                    </div>
                    <span className={`edu-tag ${cerrado ? "edu-tag--muted" : "edu-tag--ok"}`}>
                      {EDU_CASE_STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <p className="edu-estudio__meta">
                    {c.appointments} {c.appointments === 1 ? "sesión" : "sesiones"}
                    {c.notes ? ` · ${c.notes}` : ""}
                    {c.transferredFromCaseId
                      ? ` · viene de un traspaso${c.transferReason ? `: ${c.transferReason}` : ""}`
                      : ""}
                  </p>

                  {/* Ola 6 · lo que hace contable un requisito del plan de
                      estudios. Lo pone el docente, no el alumno: marcar el
                      caso decide si cuenta para el avance de ese alumno. */}
                  <EduCasoProcedimiento
                    caseId={c.id}
                    procedureId={c.procedureId}
                    procedureName={c.procedureName}
                    procedures={procedimientos.map((p) => ({
                      id: p.id,
                      name: p.name,
                      category: p.category,
                    }))}
                    canEdit={puedeClasificar}
                    cerrado={cerrado}
                  />

                  {/* Ola 4 · el gate, en la ficha del caso: en qué van sus
                      dos puertas, quién firmó qué y a qué hora, y el botón
                      del alumno. */}
                  {auth && (
                    <EduCasoAutorizaciones
                      caseId={c.id}
                      caseLabel={`${c.programName} · ${c.patientName}`}
                      gates={auth.gates}
                      rows={auth.rows}
                      canRequest={puedePedir && !cerrado}
                    />
                  )}

                  {/* Ola 14 · la lista de recetas del caso: en qué va cada
                      una y el enlace a la pestaña donde se trabajan. */}
                  {veRecetas && recetasPorCaso[i] && recetasPorCaso[i].length > 0 && (
                    <EduCasoRecetas patientId={p.id} rows={recetasPorCaso[i]} />
                  )}

                  {/* Ola de Casos · LAS ACCIONES: iniciar/alta (el gate),
                      pausar, firmar lo pendiente, registrar sesión y
                      traspasar — todo desde aquí, sin ir a otra pantalla. */}
                  <EduCasoAcciones
                    caseId={c.id}
                    patientId={p.id}
                    caseLabel={`${c.programName} · ${c.patientName}`}
                    status={c.status}
                    cerrado={cerrado}
                    gatePlanOk={
                      auth?.gates.find((g) => g.stage === "PLAN")?.verdict.ok ?? false
                    }
                    gateAltaOk={
                      auth?.gates.find((g) => g.stage === "DISCHARGE")?.verdict.ok ?? false
                    }
                    canMoverEstado={canMoverEstado}
                    canRegistrarSesion={canRegistrarSesion}
                    canTraspasar={canTraspasar}
                    canFirmar={canFirmar}
                    pendientes={(auth?.rows ?? []).filter((r) => r.status === "PENDING")}
                    alumnosDestino={alumnosDestino}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Últimas citas</h2>
          <span className="edu-count">{citas.length}</span>
        </div>
        {citas.length === 0 ? (
          <p className="edu-note">Todavía no tiene citas que te toquen.</p>
        ) : (
          <ul className="edu-chiplist">
            {citas.slice(0, 12).map((a) => (
              <li key={a.id} className="edu-assign">
                <span>
                  {/* El día viene YA calculado en la zona del instituto
                      (dayISO). Formatear el instante aquí lo pintaría en la
                      zona del navegador, y una cita de las 19:00 en Tijuana
                      saldría al día siguiente. */}
                  {eduFormatDayShort(a.dayISO)} {a.startLabel} · {a.chairName} ·{" "}
                  {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

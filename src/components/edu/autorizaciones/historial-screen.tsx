"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  EDU_APPROVAL_HISTORY_STATUSES,
  EDU_APPROVAL_STATUS_TAG,
  eduApprovalHistoryQuery,
  eduApprovalSelfMark,
  eduHasApprovalHistoryFilters,
  type EduApprovalHistoryFilters,
  type EduApprovalRow,
} from "@/lib/edu/autorizaciones-core";
import {
  EDU_APPROVAL_STAGES,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_APPROVAL_STATUS_LABELS,
  type EduApprovalStage,
  type EduApprovalStatus,
} from "@/lib/edu/types";

const RUTA = "/instituto/autorizaciones/historial";

/**
 * EL HISTORIAL DE AUTORIZACIONES — lo que ya se decidió.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NO ES LA BANDEJA, Y POR ESO NO SE PARECE.
 *
 * La bandeja se usa DE PIE, con guantes, con un paciente en el sillón: son
 * tarjetas grandes con tres botones y todo el texto que hay que leer antes
 * de firmar. Esto se usa SENTADO — una acreditación, una queja, "¿qué le
 * rechacé a Sofía el mes pasado?" —, así que es una LISTA con filtros: aquí
 * no se decide nada, se BUSCA.
 *
 * Lo que sí se reusa, literalmente, es el RENGLÓN de la ficha del caso
 * (`.edu-auth-historial__*`, en caso-autorizaciones.tsx) y su mapa de
 * tonos, que ahora vive en el módulo puro (`EDU_APPROVAL_STATUS_TAG`). Dos
 * renglones distintos para la misma fila serían dos sitios donde arreglar
 * la próxima corrección, y el día que discrepen no hay forma de saber cuál
 * miente.
 *
 * ⚠️ LOS FILTROS VIVEN EN LA URL, no en un useState (el patrón de /casos y
 * de la agenda): "lo que rechacé de endodoncia en marzo" se comparte
 * pegando el enlace y sobrevive a un refresh. Este componente solo ESCRIBE
 * la query string; quien filtra es la base, dentro del recorte.
 *
 * ⚠️ Y LAS OPCIONES vienen recortadas del servidor (la lección del P1-4 de
 * la auditoría): a un docente le llegan SUS estudiantes vigentes, a un
 * alumno no le llega ninguna lista. Que un desplegable no aparezca no es
 * una pantalla incompleta: es el alcance.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduHistorialScreenProps {
  rows: EduApprovalRow[];
  truncated: boolean;
  maxRows: number;
  filters: EduApprovalHistoryFilters;
  alumnos: { id: string; matricula: string; name: string }[];
  docentes: { id: string; name: string; isActive: boolean }[];
  programas: { id: string; name: string; isActive: boolean }[];
  /** Solo quien puede DECIDIR ve «las que decidí yo»: a un alumno le
   *  devolvería siempre cero y parecería que la pantalla está rota. */
  puedeFiltrarMias: boolean;
  /** true = quien mira no ve el instituto entero. La pantalla lo dice para
   *  que nadie lea doce renglones como si fueran el total. */
  recortado: boolean;
}

export function EduHistorialScreen({
  rows,
  truncated,
  maxRows,
  filters,
  alumnos,
  docentes,
  programas,
  puedeFiltrarMias,
  recortado,
}: EduHistorialScreenProps) {
  const router = useRouter();
  const [navegando, startNav] = useTransition();
  // Solo el BUSCADOR tiene estado local (se aplica con Enter o con la lupa,
  // como en /casos y en la lista de pacientes); el resto escribe la URL al
  // cambiar, que es lo que hace que el enlace siempre valga.
  const [q, setQ] = useState(filters.q ?? "");

  const hayFiltros = eduHasApprovalHistoryFilters(filters);

  function irCon(next: EduApprovalHistoryFilters) {
    const qs = eduApprovalHistoryQuery(next);
    startNav(() => router.replace(qs ? `${RUTA}?${qs}` : RUTA, { scroll: false }));
  }

  return (
    <>
      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          irCon({ ...filters, q: q.trim() || null });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-hist-q">
            Paciente
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-hist-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre o folio"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-hist-estado">
            Estado
          </label>
          <select
            id="edu-hist-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? ""}
            onChange={(e) =>
              irCon({ ...filters, status: (e.target.value || null) as EduApprovalStatus | null })
            }
          >
            {/* «Esperando firma» NO está: eso es la bandeja, no el
                historial. La lista viene del módulo puro, así que si mañana
                el enum gana un estado decidido, este desplegable lo tiene
                sin que nadie se acuerde de venir. */}
            <option value="">Todas las decididas</option>
            {EDU_APPROVAL_HISTORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_APPROVAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-hist-etapa">
            Qué se autorizaba
          </label>
          <select
            id="edu-hist-etapa"
            className="edu-input edu-input--sm"
            value={filters.stage ?? ""}
            onChange={(e) =>
              irCon({ ...filters, stage: (e.target.value || null) as EduApprovalStage | null })
            }
          >
            <option value="">Todo</option>
            {EDU_APPROVAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {EDU_APPROVAL_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-hist-esp">
            Especialidad
          </label>
          <select
            id="edu-hist-esp"
            className="edu-input edu-input--sm"
            value={filters.programId ?? ""}
            onChange={(e) => irCon({ ...filters, programId: e.target.value || null })}
          >
            <option value="">Todas</option>
            {programas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        </div>

        {/* Vacío para el ALUMNO: sus autorizaciones ya son las suyas, y un
            desplegable con su propio nombre sería ruido. No lo esconde un
            `if` de rol — llega vacío del servidor, por alcance. */}
        {alumnos.length > 0 && (
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-hist-alumno">
              Estudiante
            </label>
            <select
              id="edu-hist-alumno"
              className="edu-input edu-input--sm"
              value={filters.studentId ?? ""}
              onChange={(e) => irCon({ ...filters, studentId: e.target.value || null })}
            >
              <option value="">Todos</option>
              {alumnos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.matricula} · {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {docentes.length > 0 && (
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-hist-docente">
              Quién decidió
            </label>
            <select
              id="edu-hist-docente"
              className="edu-input edu-input--sm"
              value={filters.decidedByUserId ?? ""}
              onChange={(e) =>
                irCon({ ...filters, decidedByUserId: e.target.value || null, soloMias: false })
              }
            >
              <option value="">Cualquiera</option>
              {docentes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isActive ? "" : " (baja)"}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-hist-desde">
            Decididas del
          </label>
          <input
            id="edu-hist-desde"
            className="edu-input edu-input--sm"
            type="date"
            value={filters.desdeISO ?? ""}
            onChange={(e) => irCon({ ...filters, desdeISO: e.target.value || null })}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-hist-hasta">
            al
          </label>
          <input
            id="edu-hist-hasta"
            className="edu-input edu-input--sm"
            type="date"
            value={filters.hastaISO ?? ""}
            onChange={(e) => irCon({ ...filters, hastaISO: e.target.value || null })}
          />
        </div>

        {puedeFiltrarMias && (
          <label className="edu-check edu-authhist__mias">
            <input
              type="checkbox"
              checked={filters.soloMias}
              onChange={(e) =>
                // Al marcarlo se limpia el desplegable de docente: los dos a
                // la vez darían cero filas y parecería un error.
                irCon({ ...filters, soloMias: e.target.checked, decidedByUserId: null })
              }
            />
            <span className="edu-check__body">
              <span className="edu-check__label">Las que decidí yo</span>
            </span>
          </label>
        )}

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace(RUTA, { scroll: false }));
            }}
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </form>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navegando
            ? "Buscando…"
            : `${rows.length} ${rows.length === 1 ? "autorización" : "autorizaciones"}${
                truncated ? ` (se muestran las ${maxRows} más recientes)` : ""
              }${recortado ? " · las que te tocan" : ""}`}
        </span>
      </div>

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Hay más de {maxRows}, y se muestran las más recientes</p>
            <p className="edu-banner__detail">
              Acota con los filtros —un rango de fechas, una especialidad o un estudiante— para ver
              el resto. Lo que no sale aquí no se perdió: sigue en la pestaña Casos de cada
              paciente, que es donde vive el expediente de cada caso.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ninguna autorización coincide" : "Todavía no se ha decidido ninguna"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros o con un rango de fechas más ancho. Ojo: aquí solo sale lo que YA se decidió — lo que sigue esperando firma está en la bandeja."
              : "En cuanto se firme, se rechace o se devuelva con cambios una autorización que te toque, quedará aquí con quién la pidió, quién la decidió y a qué hora. Lo que sigue esperando está en la bandeja."}
          </p>
        </div>
      ) : (
        // 🔴 @container y no @media: lo que decide si el renglón cabe en
        // dos columnas es el ancho de ESTA lista, no el del navegador —
        // dentro del panel, el menú abierto se lleva 240 px. Es seguro
        // porque aquí dentro no hay nada `position: fixed` (la contención
        // que crea `container-type` atraparía un modal, y por eso ni
        // .edu-shell ni .edu-body la llevan).
        <div className="edu-authhist">
          <ul className="edu-auth-historial">
            {rows.map((r) => (
              <li key={r.id} className="edu-auth-historial__item">
                {/* TODA la fila es el enlace, y va al caso: quien está
                    auditando quiere el expediente, no un submenú. Un solo
                    enlace por renglón (y no uno por dato) es también lo
                    que lo deja usable con teclado. */}
                <Link
                  href={`/instituto/pacientes/${r.patientId}/casos`}
                  className="edu-authhist__fila"
                  aria-label={`${r.stageLabel} de ${r.patientName}: ${
                    EDU_APPROVAL_STATUS_LABELS[r.status]
                  }. Abrir el caso.`}
                >
                  <div className="edu-auth-historial__head">
                    <span className="edu-auth-historial__stage">
                      {r.stageLabel}
                      {r.isEmergency ? " · urgencia" : ""}
                    </span>
                    <span className={`edu-tag ${EDU_APPROVAL_STATUS_TAG[r.status]}`}>
                      {EDU_APPROVAL_STATUS_LABELS[r.status]}
                    </span>
                  </div>

                  <p className="edu-authhist__quien">
                    {r.patientName} <span className="edu-authhist__folio">{r.patientFolio}</span>
                  </p>

                  {/* QUÉ exactamente se autorizaba: el título del contenido,
                      no un "documento #3". Va a lo ancho porque es la línea
                      que se lee; el detalle completo está en el caso, a
                      donde lleva esta misma fila. */}
                  {r.summary.title && (
                    <p className="edu-auth-historial__meta">{r.summary.title}</p>
                  )}

                  {/* Las dos líneas de CONTEXTO. En dos columnas cuando la
                      lista tiene sitio (@container), apiladas cuando no.
                      Es un grid y no dos inline-block: con anchos al 50 %
                      el espacio en blanco entre las etiquetas basta para
                      desbordar y tirar la segunda a la línea de abajo. */}
                  <div className="edu-authhist__datos">
                    <p className="edu-auth-historial__meta">
                      {r.programName} · {r.studentMatricula} {r.studentName}
                    </p>

                    <p className="edu-auth-historial__meta">
                      Pedida por {r.requestedByName} el {r.requestedAtLabel}
                      {r.decidedByName && r.decidedAtLabel
                        ? ` · ${r.status === "APPROVED" ? "firmada" : "decidida"} por ${
                            r.decidedByName
                          } el ${r.decidedAtLabel}`
                        : ""}
                    </p>
                  </div>

                  {/* Nadie la decidió: la cerró un REENVÍO del estudiante.
                      Se dice con todas sus letras en vez de dejar un hueco
                      donde debería ir un nombre — el hueco se lee como un
                      dato perdido, y no lo es. */}
                  {!r.decidedByName && (
                    <p className="edu-auth-historial__meta">
                      No la decidió nadie: el estudiante volvió a mandarla y ésta quedó cerrada. La
                      buena es la siguiente.
                    </p>
                  )}

                  {r.isEmergency && (
                    <p className="edu-auth-historial__meta">
                      Se procedió sin firma previa.{" "}
                      {r.emergencyReason ?? "El estudiante no escribió el motivo."}
                    </p>
                  )}

                  {/* LA TRAZA: quien decidió es quien pidió. Sale del propio
                      registro (decidedById === requestedById); hoy solo la
                      puede producir la DIRECCIÓN, la única exenta de «nadie
                      firma su propia petición». */}
                  {r.selfDecided && (
                    <p className="edu-auth-historial__marca">{eduApprovalSelfMark(r.status)}</p>
                  )}

                  {r.decisionNote && (
                    <p className="edu-auth-historial__nota">“{r.decisionNote}”</p>
                  )}

                  {r.status === "EXPIRED" && r.storedStatus === "APPROVED" && (
                    <p className="edu-auth-historial__nota">
                      Estaba firmada y se editó lo que decía. La firma cubría el texto anterior, así
                      que dejó de valer: hay que mandarla otra vez.
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

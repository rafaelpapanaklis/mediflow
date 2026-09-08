"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
// 🔴 `import type` Y NO UN IMPORT NORMAL. `docente.ts` importa prisma; el
// `import type` lo BORRA el compilador antes de empaquetar, así que nada
// del servidor cruza al navegador. Se hace así —y no copiando el tipo aquí—
// porque dos declaraciones del mismo objeto se separan en el primer campo
// nuevo sin que el compilador diga nada. Si algún día hace falta un VALOR
// de ese archivo, no se importa: se mueve a un `-core`.
import type { EduRotacionProgramada } from "@/lib/edu/docente";

/**
 * LA ROTACIÓN DOCENTE PROGRAMADA, en la pantalla de Docentes (Ola C·2).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CIERRA
 *
 * Rotar de docente ya se podía, pero SIEMPRE con efecto inmediato: el
 * endpoint escribía `startsAt: now` a pelo. En una escuela real la rotación
 * se decide en junta y arranca el lunes siguiente, y hacerla el lunes a
 * mano es como se llega a un alumno sin docente durante tres días.
 *
 * 🔴 CERO SQL Y CERO COLUMNAS: `startsAt` existe desde la Ola 1A y el
 * predicado de vigencia del padrón ya filtra `startsAt <= now`. Lo único
 * que faltaba era escribir una fecha futura y poder VER lo programado
 * antes de que llegue — una asignación que existe y no se puede ver es
 * peor que no tenerla.
 *
 * ⚠️ PROGRAMAR NO CIERRA AL TITULAR DE HOY, y la pantalla lo DICE. Cerrarlo
 * ahora dejaría al alumno sin supervisión hasta que el relevo entre. El
 * porqué largo está en `programarEduRotacion` (src/lib/edu/docente.ts).
 *
 * ⚠️ El componente vive junto a su página y no en `src/components/edu/`
 * porque `docentes-screen.tsx` es de otra casilla de esta ola: así esta
 * rotación no toca ni una línea suya. Queda anotado en el reporte.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduRotacionPanelProps {
  rows: EduRotacionProgramada[];
  /** Los alumnos ACTIVOS a los que llega quien mira, para el alta. */
  students: { id: string; matricula: string; name: string; programName: string }[];
  teachers: { id: string; name: string }[];
  canAssign: boolean;
  /** La zona del instituto: con ella se fecha cada arranque. */
  timezone: string;
}

export function EduRotacionProgramadaPanel({
  rows,
  students,
  teachers,
  canAssign,
  timezone,
}: EduRotacionPanelProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [creando, setCreando] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));

  async function cancelar(r: EduRotacionProgramada) {
    setBusyId(r.id);
    setError(null);
    try {
      await eduRequest(`/api/instituto/supervision/programadas/${r.id}`, { method: "DELETE" });
      setFlash(
        `Cancelada la rotación de ${r.studentName}. La fila no se borra: dentro de un año hay que poder ver que se programó y se dio marcha atrás.`,
      );
      startNav(() => router.refresh());
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo cancelar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="edu-section">
      <div className="edu-section__head">
        <div>
          <h2 className="edu-section__title">Rotaciones programadas</h2>
          <p className="edu-section__lead">
            Relevos de docente con fecha de arranque. Hasta que llegue esa fecha no cambia nada: el
            padrón, la agenda y el acceso al expediente siguen contando al titular de hoy.
          </p>
        </div>
        <span className="edu-count">{rows.length}</span>
      </div>

      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {rows.length === 0
            ? "Nada programado"
            : `${rows.length} ${rows.length === 1 ? "rotación" : "rotaciones"} por arrancar`}
        </span>
        {canAssign ? (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setCreando(true);
            }}
            disabled={students.length === 0 || teachers.length === 0}
            title={
              students.length === 0 || teachers.length === 0
                ? "Hacen falta al menos un estudiante activo y un docente para programar una rotación."
                : undefined
            }
          >
            <CalendarClock size={16} />
            Programar rotación
          </button>
        ) : (
          // Deshabilitado CON motivo, nunca un botón que no hace nada.
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            disabled
            title="Repartir alumnos pide el permiso supervision.assign, que por defecto solo lleva la dirección."
          >
            <CalendarClock size={16} />
            Programar rotación
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="edu-note">
          Cuando programes un relevo con fecha, aparecerá aquí hasta que arranque. Programar no
          cierra al titular de hoy: si lo cerrara, el alumno se quedaría sin docente los días de en
          medio.
        </p>
      ) : (
        <div className="edu-tablewrap">
          {/* `edu-tablewrap` mide esta lista contra SÍ MISMA (`@container`)
              y la deja desplazarse en vez de recortar. */}
          <div className="edu-table edu-table--rotaciones">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Estudiante</span>
              <span>Docente que entra</span>
              <span>Desde</span>
              <span>Tipo</span>
              <span />
            </div>
            {rows.map((r) => (
              <div key={r.id} className="edu-row">
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Estudiante</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.studentName}</span>
                  <span className="edu-cell__sub">
                    {r.matricula} · {r.programName}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Docente que entra</span>
                  <span className="edu-cell__value">{r.supervisorName}</span>
                  {/* «De X a Y» y no solo «Y»: sin el titular de hoy, la
                      fila no dice qué CAMBIA. */}
                  <span className="edu-cell__sub">
                    {r.titularActual ? `Hoy lo lleva ${r.titularActual}` : "Hoy no tiene titular"}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Desde</span>
                  <span className="edu-cell__value">{fecha(r.startsAt)}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Tipo</span>
                  <span className="edu-cell__value">
                    {r.isPrimary ? "Titular" : "Apoyo"}
                  </span>
                </div>
                <div className="edu-cell__actions">
                  {canAssign ? (
                    <button
                      type="button"
                      className="edu-btn edu-btn--quiet edu-btn--sm"
                      onClick={() => cancelar(r)}
                      disabled={busyId === r.id}
                    >
                      {busyId === r.id ? "Cancelando…" : "Cancelar"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="edu-btn edu-btn--quiet edu-btn--sm"
                      disabled
                      title="Cancelar una rotación pide el permiso supervision.assign, que por defecto solo lleva la dirección."
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {creando && (
        <ProgramarRotacion
          students={students}
          teachers={teachers}
          onClose={() => setCreando(false)}
          onDone={(mensaje) => {
            setCreando(false);
            setFlash(mensaje);
            setError(null);
            startNav(() => router.refresh());
          }}
        />
      )}
    </section>
  );
}

/** Mañana en formato AAAA-MM-DD: el primer día que una rotación puede arrancar. */
function mananaISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function ProgramarRotacion({
  students,
  teachers,
  onClose,
  onDone,
}: {
  students: { id: string; matricula: string; name: string; programName: string }[];
  teachers: { id: string; name: string }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [supervisorUserId, setSupervisorUserId] = useState(teachers[0]?.id ?? "");
  const [desde, setDesde] = useState(mananaISO());
  const [isPrimary, setIsPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/supervision/programadas", {
        method: "POST",
        body: {
          studentId,
          supervisorUserId,
          isPrimary,
          // 🔴 SE MANDA EL DÍA A MEDIANOCHE UTC y no un instante local: la
          // rotación es una decisión de CALENDARIO ("desde el lunes"), no
          // de reloj, y la hora exacta no cambia nada — el predicado de
          // vigencia solo compara instantes. Mandar la hora del navegador
          // haría que la misma fecha arrancara distinto según quién la
          // capturó.
          startsAt: `${desde}T00:00:00.000Z`,
        },
      });
      const alumno = students.find((s) => s.id === studentId);
      onDone(
        `Rotación programada para ${alumno?.name ?? "el estudiante"} desde el ${desde}. Hasta ese día no cambia nada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo programar la rotación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Programar una rotación"
      subtitle="El relevo entra el día que digas. Hasta entonces, todo sigue igual."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || !studentId || !supervisorUserId || !desde}
          >
            {busy ? "Guardando…" : "Programar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-rot-alumno">
          Estudiante
        </label>
        <select
          id="edu-rot-alumno"
          className="edu-input"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.matricula} · {s.name} · {s.programName}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-rot-docente">
          Docente que entra
        </label>
        <select
          id="edu-rot-docente"
          className="edu-input"
          value={supervisorUserId}
          onChange={(e) => setSupervisorUserId(e.target.value)}
        >
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-rot-desde">
          Arranca el
        </label>
        <input
          id="edu-rot-desde"
          className="edu-input"
          type="date"
          value={desde}
          min={mananaISO()}
          onChange={(e) => setDesde(e.target.value)}
        />
        <p className="edu-field__hint">
          Tiene que ser una fecha futura. Para que entre YA, usa el botón normal de asignar: ése sí
          cierra al titular anterior en el mismo acto.
        </p>
      </div>

      <label className="edu-check">
        <input
          className="edu-check__input"
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Entra como TITULAR</span>
          <span className="edu-check__hint">
            Apágalo si es un docente de apoyo que se suma sin relevar a nadie.
          </span>
        </span>
      </label>

      <div className="edu-banner edu-banner--warn" role="status">
        <div>
          <p className="edu-banner__title">Esto NO cierra al titular de hoy</p>
          <p className="edu-banner__detail">
            Y es a propósito: cerrarlo ahora dejaría al estudiante sin supervisión clínica —y sin
            nadie que le firme una autorización— hasta que el relevo entre. Desde la fecha que
            elijas los dos quedan vigentes; cierra al saliente ese día desde su ficha, o antes si la
            escuela ya lo decidió.
          </p>
        </div>
      </div>
    </EduModal>
  );
}

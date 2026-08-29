"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, FolderPlus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { eduDateInputValue, formatEduDate } from "@/lib/edu/padron-core";
import type { EduCohortRow, EduProgramRow } from "@/lib/edu/padron-core";

/**
 * /instituto/padron/estructura — programas y generaciones.
 *
 * Toda la pantalla exige padron.manage (lo comprueba la página, y cada
 * endpoint lo vuelve a comprobar por su cuenta).
 *
 * 🔴 AQUÍ NO SE BORRA NADA. Un programa con alumnos no se elimina: se
 * DESACTIVA. Borrarlo se llevaría por delante sus generaciones y sus fichas
 * (la FK va en cascada), y el padrón es un registro histórico: el alumno que
 * egresó de una especialidad que la escuela ya no imparte siguió existiendo.
 * Por eso el único "apagador" es isActive, y lo único que hace es sacarlo de
 * los desplegables de alta.
 */
export interface EduEstructuraScreenProps {
  programs: EduProgramRow[];
  cohorts: EduCohortRow[];
}

export function EduEstructuraScreen({ programs, cohorts }: EduEstructuraScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [programaEnEdicion, setProgramaEnEdicion] = useState<EduProgramRow | null>(null);
  const [nuevoPrograma, setNuevoPrograma] = useState(false);
  const [generacionEnEdicion, setGeneracionEnEdicion] = useState<EduCohortRow | null>(null);
  const [nuevaGeneracion, setNuevaGeneracion] = useState(false);

  function recargar(mensaje: string) {
    setError(null);
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  async function alternar(tipo: "programas" | "generaciones", id: string, isActive: boolean) {
    setError(null);
    setBusyId(id);
    try {
      await eduRequest(`/api/instituto/${tipo}/${id}`, { method: "PATCH", body: { isActive } });
      recargar(isActive ? "Se activó." : "Se desactivó. No se borró nada.");
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
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

      {/* ── Programas ───────────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Programas</h2>
            <p className="edu-section__lead">
              Las especialidades que imparte el instituto. La clave es la que ya usan en sus
              papeles y no se puede repetir.
            </p>
          </div>
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setNuevoPrograma(true);
            }}
          >
            <FolderPlus size={16} />
            Nuevo programa
          </button>
        </div>

        {programs.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Todavía no hay programas</p>
            <p className="edu-empty__detail">
              Un programa es una especialidad: Endodoncia, Ortodoncia, Periodoncia. Es lo primero
              que hay que crear: sin programa no hay generación, y sin generación no se puede
              inscribir a nadie.
            </p>
          </div>
        ) : (
          <div className="edu-table edu-table--programas">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Programa</span>
              <span>Clave</span>
              <span>Duración</span>
              <span>Generaciones</span>
              <span>Alumnos</span>
              <span>Estado</span>
              <span />
            </div>

            {programs.map((p) => (
              <div key={p.id} className={`edu-row ${p.isActive ? "" : "edu-row--off"}`}>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Programa</span>
                  <span className="edu-cell__value edu-cell__value--strong">{p.name}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Clave</span>
                  <span className="edu-cell__value">{p.code}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Duración</span>
                  <span className="edu-cell__value">{p.durationSemesters} semestres</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Generaciones</span>
                  <span className="edu-cell__value">{p.cohorts}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Alumnos</span>
                  <span className="edu-cell__value">{p.students}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span className={`edu-tag ${p.isActive ? "edu-tag--ok" : "edu-tag--muted"}`}>
                    {p.isActive ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="edu-cell__actions">
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setProgramaEnEdicion(p);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="edu-btn edu-btn--quiet edu-btn--sm"
                    onClick={() => alternar("programas", p.id, !p.isActive)}
                    disabled={busyId === p.id}
                  >
                    {p.isActive ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Generaciones ────────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Generaciones</h2>
            <p className="edu-section__lead">
              Cada generación pertenece a un programa. El nombre —&quot;2026-A&quot;— se puede
              repetir entre programas distintos, pero no dentro del mismo.
            </p>
          </div>
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setNuevaGeneracion(true);
            }}
            disabled={programs.filter((p) => p.isActive).length === 0}
          >
            <CalendarPlus size={16} />
            Nueva generación
          </button>
        </div>

        {cohorts.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Todavía no hay generaciones</p>
            <p className="edu-empty__detail">
              {programs.filter((p) => p.isActive).length === 0
                ? "Antes hace falta un programa activo."
                : "Una generación es la promoción que entra junta: 2026-A. Los alumnos se inscriben a una."}
            </p>
          </div>
        ) : (
          <div className="edu-table edu-table--generaciones">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Generación</span>
              <span>Programa</span>
              <span>Inicio</span>
              <span>Fin</span>
              <span>Alumnos</span>
              <span>Estado</span>
              <span />
            </div>

            {cohorts.map((c) => (
              <div key={c.id} className={`edu-row ${c.isActive ? "" : "edu-row--off"}`}>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Generación</span>
                  <span className="edu-cell__value edu-cell__value--strong">{c.name}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Programa</span>
                  <span className="edu-cell__value">{c.programName}</span>
                  <span className="edu-cell__sub">{c.programCode}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Inicio</span>
                  <span className="edu-cell__value">{formatEduDate(c.startDate)}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Fin</span>
                  <span className="edu-cell__value">
                    {c.endDate ? formatEduDate(c.endDate) : "Sin fecha"}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Alumnos</span>
                  <span className="edu-cell__value">{c.students}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span className={`edu-tag ${c.isActive ? "edu-tag--ok" : "edu-tag--muted"}`}>
                    {c.isActive ? "Abierta" : "Cerrada"}
                  </span>
                </div>
                <div className="edu-cell__actions">
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setGeneracionEnEdicion(c);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="edu-btn edu-btn--quiet edu-btn--sm"
                    onClick={() => alternar("generaciones", c.id, !c.isActive)}
                    disabled={busyId === c.id}
                  >
                    {c.isActive ? "Cerrar" : "Reabrir"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(nuevoPrograma || programaEnEdicion) && (
        <ProgramaModal
          program={programaEnEdicion}
          onClose={() => {
            setNuevoPrograma(false);
            setProgramaEnEdicion(null);
          }}
          onDone={(mensaje) => {
            setNuevoPrograma(false);
            setProgramaEnEdicion(null);
            recargar(mensaje);
          }}
        />
      )}

      {(nuevaGeneracion || generacionEnEdicion) && (
        <GeneracionModal
          cohort={generacionEnEdicion}
          programs={programs}
          onClose={() => {
            setNuevaGeneracion(false);
            setGeneracionEnEdicion(null);
          }}
          onDone={(mensaje) => {
            setNuevaGeneracion(false);
            setGeneracionEnEdicion(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function ProgramaModal({
  program,
  onClose,
  onDone,
}: {
  program: EduProgramRow | null;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState(program?.name ?? "");
  const [code, setCode] = useState(program?.code ?? "");
  const [duration, setDuration] = useState(String(program?.durationSemesters ?? 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      if (program) {
        await eduRequest(`/api/instituto/programas/${program.id}`, {
          method: "PATCH",
          body: { name, code, durationSemesters: duration },
        });
        onDone(`Se actualizó ${name}.`);
      } else {
        await eduRequest("/api/instituto/programas", {
          method: "POST",
          body: { name, code, durationSemesters: duration },
        });
        onDone(`Se creó el programa ${name}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={program ? "Editar programa" : "Nuevo programa"}
      subtitle={program ? undefined : "Una especialidad del instituto."}
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
            disabled={busy || !name.trim() || !code.trim()}
          >
            {busy ? "Guardando…" : "Guardar"}
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
        <label className="edu-field__label" htmlFor="edu-p-nombre">
          Nombre
        </label>
        <input
          id="edu-p-nombre"
          className="edu-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Endodoncia"
          autoComplete="off"
        />
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-clave">
            Clave
          </label>
          <input
            id="edu-p-clave"
            className="edu-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ENDO"
            autoComplete="off"
          />
          <span className="edu-field__hint">Mayúsculas, sin espacios. Única en el instituto.</span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-duracion">
            Duración (semestres)
          </label>
          <input
            id="edu-p-duracion"
            className="edu-input"
            type="number"
            min={1}
            max={20}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
      </div>

      {program && program.students > 0 && (
        <p className="edu-note">
          Este programa tiene {program.students}{" "}
          {program.students === 1 ? "alumno inscrito" : "alumnos inscritos"}. Cambiarle el nombre o
          la clave no los mueve de sitio.
        </p>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function GeneracionModal({
  cohort,
  programs,
  onClose,
  onDone,
}: {
  cohort: EduCohortRow | null;
  programs: EduProgramRow[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const activos = programs.filter((p) => p.isActive);
  const [programId, setProgramId] = useState(cohort?.programId ?? activos[0]?.id ?? "");
  const [name, setName] = useState(cohort?.name ?? "");
  const [startDate, setStartDate] = useState(eduDateInputValue(cohort?.startDate ?? null));
  const [endDate, setEndDate] = useState(eduDateInputValue(cohort?.endDate ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      if (cohort) {
        await eduRequest(`/api/instituto/generaciones/${cohort.id}`, {
          method: "PATCH",
          body: { name, startDate, endDate: endDate || null },
        });
        onDone(`Se actualizó la generación ${name}.`);
      } else {
        await eduRequest("/api/instituto/generaciones", {
          method: "POST",
          body: { programId, name, startDate, endDate: endDate || null },
        });
        onDone(`Se creó la generación ${name}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={cohort ? "Editar generación" : "Nueva generación"}
      subtitle={cohort ? `${cohort.programName} · ${cohort.programCode}` : undefined}
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
            disabled={busy || !name.trim() || !startDate || (!cohort && !programId)}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!cohort && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-g-programa">
            Programa
          </label>
          <select
            id="edu-g-programa"
            className="edu-input"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
          >
            <option value="">Elige…</option>
            {activos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            El programa de una generación no se cambia después: los alumnos ya inscritos quedarían
            en una especialidad que no cursaron.
          </span>
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-g-nombre">
          Nombre
        </label>
        <input
          id="edu-g-nombre"
          className="edu-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="2026-A"
          autoComplete="off"
        />
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-g-inicio">
            Inicio
          </label>
          <input
            id="edu-g-inicio"
            className="edu-input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-g-fin">
            Fin (opcional)
          </label>
          <input
            id="edu-g-fin"
            className="edu-input"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <span className="edu-field__hint">Déjalo vacío si todavía no se sabe.</span>
        </div>
      </div>
    </EduModal>
  );
}

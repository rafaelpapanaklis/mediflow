"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_REQUIREMENT_MAX_COUNT, type EduRequirementRow } from "@/lib/edu/evaluacion-core";

/**
 * /instituto/requisitos — EL PLAN DE ESTUDIOS, EN NÚMEROS.
 *
 * "Para cerrar tercer semestre de Endodoncia hacen falta 8 endodoncias
 * unirradiculares terminadas." Eso, capturado, es lo que convierte la
 * pantalla del alumno en "te faltan 3 de 8" en vez de en una sensación.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL AVANCE NO SE CAPTURA NUNCA. Aquí se dice qué se necesita; cuántos
 * lleva cada alumno se CUENTA solo, contando sus casos. Por eso desactivar
 * un requisito no borra nada y volver a activarlo lo devuelve todo: no hay
 * ningún contador que reconstruir.
 *
 * ⚠️ Un requisito puede pedir un PROCEDIMIENTO concreto o una CATEGORÍA
 * entera, pero no las dos: juntas casi nunca coinciden y el requisito
 * contaría cero sin que nadie supiera por qué.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduRequisitosScreenProps {
  rows: EduRequirementRow[];
  programs: { id: string; name: string; durationSemesters: number }[];
  procedures: { id: string; name: string; category: string | null }[];
  categories: string[];
}

export function EduRequisitosScreen({
  rows,
  programs,
  procedures,
  categories,
}: EduRequisitosScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<EduRequirementRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  async function alternar(r: EduRequirementRow) {
    setBusyId(r.id);
    setError(null);
    try {
      await eduRequest(`/api/instituto/requisitos/${r.id}`, {
        method: "PATCH",
        body: { isActive: !r.isActive },
      });
      recargar(
        r.isActive
          ? `"${r.name}" deja de exigirse. No se borra nada de lo que los alumnos ya hicieron: el avance se cuenta, no se guarda.`
          : `"${r.name}" vuelve a exigirse, y los casos que ya tenían cuentan solos.`,
      );
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo cambiar el requisito.");
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

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {rows.length} {rows.length === 1 ? "requisito" : "requisitos"}
        </span>
        <button
          type="button"
          className="edu-btn edu-btn--primary edu-btn--sm"
          onClick={() => {
            setFlash(null);
            setCreando(true);
          }}
          disabled={programs.length === 0}
        >
          <Plus size={16} />
          Nuevo requisito
        </button>
      </div>

      {programs.length === 0 && (
        <p className="edu-note">
          Primero da de alta una especialidad en Especialidades y generaciones: un requisito es de
          un plan de estudios, y un plan de estudios es de una especialidad.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay requisitos</p>
          <p className="edu-empty__detail">
            Sin requisitos, la pantalla de Evaluación no puede decirle a nadie cuánto le falta —
            solo cuántos casos lleva. Captura los de cada especialidad: cuántos de qué, y para
            cuándo.
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--requisitos">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Requisito</span>
            <span>Especialidad</span>
            <span>Qué cuenta</span>
            <span>Cuántos</span>
            <span>Se exige</span>
            <span />
          </div>

          {rows.map((r) => (
            <div key={r.id} className={`edu-row ${r.isActive ? "" : "edu-row--off"}`}>
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Requisito</span>
                <span className="edu-cell__value edu-cell__value--strong">{r.name}</span>
                {r.notes && <span className="edu-cell__sub">{r.notes}</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Especialidad</span>
                <span className="edu-cell__value">{r.programName}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Qué cuenta</span>
                <span className="edu-cell__value">
                  {r.procedureName ?? r.category ?? "Cualquier caso de la especialidad"}
                </span>
                <span className="edu-cell__sub">
                  {r.onlyCompleted ? "solo casos terminados" : "abiertos o terminados"}
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Cuántos</span>
                <span className="edu-cell__value edu-cell__value--strong">{r.requiredCount}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Se exige</span>
                {/* P2-5: "Se exige de 3º a 5º" y no "3º – 5º" a secas — el
                    rango decide desde cuándo lo espera el semáforo, no qué
                    casos cuentan, y la etiqueta tiene que leerse como lo
                    que hace. */}
                <span className="edu-cell__value">
                  {r.semesterFrom || r.semesterTo
                    ? `De ${r.semesterFrom ?? 1}º a ${r.semesterTo ? `${r.semesterTo}º` : "fin del plan"}`
                    : "Todo el plan"}
                </span>
                {!r.isActive && <span className="edu-tag edu-tag--muted">Desactivado</span>}
              </div>

              <div className="edu-cell__actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => {
                    setFlash(null);
                    setEditando(r);
                  }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet edu-btn--sm"
                  onClick={() => alternar(r)}
                  disabled={busyId === r.id}
                >
                  {r.isActive ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creando || editando) && (
        <EditorRequisito
          requisito={editando}
          programs={programs}
          procedures={procedures}
          categories={categories}
          onClose={() => {
            setCreando(false);
            setEditando(null);
          }}
          onDone={(mensaje) => {
            setCreando(false);
            setEditando(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

function EditorRequisito({
  requisito,
  programs,
  procedures,
  categories,
  onClose,
  onDone,
}: {
  requisito: EduRequirementRow | null;
  programs: { id: string; name: string; durationSemesters: number }[];
  procedures: { id: string; name: string; category: string | null }[];
  categories: string[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState(requisito?.name ?? "");
  const [programId, setProgramId] = useState(requisito?.programId ?? programs[0]?.id ?? "");
  const [modo, setModo] = useState<"procedimiento" | "categoria" | "cualquiera">(
    requisito?.procedureId ? "procedimiento" : requisito?.category ? "categoria" : "cualquiera",
  );
  const [procedureId, setProcedureId] = useState(requisito?.procedureId ?? "");
  const [category, setCategory] = useState(requisito?.category ?? "");
  const [requiredCount, setRequiredCount] = useState(String(requisito?.requiredCount ?? ""));
  const [semesterFrom, setSemesterFrom] = useState(
    requisito?.semesterFrom ? String(requisito.semesterFrom) : "",
  );
  const [semesterTo, setSemesterTo] = useState(
    requisito?.semesterTo ? String(requisito.semesterTo) : "",
  );
  const [onlyCompleted, setOnlyCompleted] = useState(requisito?.onlyCompleted ?? true);
  const [notes, setNotes] = useState(requisito?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        programId,
        procedureId: modo === "procedimiento" ? procedureId || null : null,
        category: modo === "categoria" ? category.trim() || null : null,
        requiredCount: requiredCount.trim(),
        semesterFrom: semesterFrom.trim() || null,
        semesterTo: semesterTo.trim() || null,
        onlyCompleted,
        notes: notes.trim() || null,
      };

      if (requisito) {
        await eduRequest(`/api/instituto/requisitos/${requisito.id}`, { method: "PATCH", body });
        onDone(`Requisito "${body.name}" guardado. El avance de cada alumno se recalcula solo.`);
      } else {
        await eduRequest("/api/instituto/requisitos", { method: "POST", body });
        onDone(`Requisito "${body.name}" capturado.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el requisito.");
    } finally {
      setBusy(false);
    }
  }

  const programa = programs.find((p) => p.id === programId) ?? null;

  return (
    <EduModal
      title={requisito ? "Editar el requisito" : "Nuevo requisito"}
      subtitle="Cuántos de qué necesita un alumno para cerrar. El avance se cuenta solo."
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
            disabled={busy || !name.trim() || !programId || !requiredCount.trim()}
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
        <label className="edu-field__label" htmlFor="edu-req-name">
          Nombre
        </label>
        <input
          id="edu-req-name"
          className="edu-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Endodoncias unirradiculares"
          autoComplete="off"
        />
      </div>

      <div className="edu-formgrid">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-prog">
            Especialidad
          </label>
          <select
            id="edu-req-prog"
            className="edu-input"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            disabled={Boolean(requisito)}
          >
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {requisito && (
            <p className="edu-field__hint">
              La especialidad no se cambia: sería otro requisito, de otro plan.
            </p>
          )}
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-count">
            Cuántos necesita
          </label>
          <input
            id="edu-req-count"
            className="edu-input"
            inputMode="numeric"
            value={requiredCount}
            onChange={(e) => setRequiredCount(e.target.value)}
            placeholder="8"
            autoComplete="off"
          />
          <p className="edu-field__hint">Entre 1 y {EDU_REQUIREMENT_MAX_COUNT}.</p>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-from">
            Desde el semestre
          </label>
          <input
            id="edu-req-from"
            className="edu-input"
            inputMode="numeric"
            value={semesterFrom}
            onChange={(e) => setSemesterFrom(e.target.value)}
            placeholder="1"
            autoComplete="off"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-to">
            Hasta el semestre
          </label>
          <input
            id="edu-req-to"
            className="edu-input"
            inputMode="numeric"
            value={semesterTo}
            onChange={(e) => setSemesterTo(e.target.value)}
            placeholder={programa ? String(programa.durationSemesters) : "6"}
            autoComplete="off"
          />
        </div>
      </div>

      {/* P2-5: el rango por fin hace algo, y la captura tiene que decir QUÉ
          — sin esta frase, quien captura "5º–6º" cree que un caso de 1º
          dejará de contar, y no es eso lo que decide. */}
      <p className="edu-field__hint">
        El rango marca CUÁNDO se le exige al alumno: antes del semestre inicial el semáforo no se
        lo cuenta como pendiente, y dentro del rango la expectativa crece semestre a semestre. Un
        caso hecho antes del rango sí cuenta — lo que se acota es cuándo se espera, no cuándo se
        hizo.
      </p>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-req-modo">
          Qué cuenta
        </label>
        <select
          id="edu-req-modo"
          className="edu-input"
          value={modo}
          onChange={(e) => setModo(e.target.value as typeof modo)}
        >
          <option value="procedimiento">Un procedimiento concreto</option>
          <option value="categoria">Toda una categoría del catálogo</option>
          <option value="cualquiera">Cualquier caso de la especialidad</option>
        </select>
        <p className="edu-field__hint">
          Un procedimiento O una categoría, nunca las dos: juntas casi nunca coinciden y el
          requisito contaría cero.
        </p>
      </div>

      {modo === "procedimiento" && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-proc">
            Procedimiento
          </label>
          <select
            id="edu-req-proc"
            className="edu-input"
            value={procedureId}
            onChange={(e) => setProcedureId(e.target.value)}
          >
            <option value="">Elige uno</option>
            {procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.category ? ` · ${p.category}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {modo === "categoria" && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-cat">
            Categoría
          </label>
          <input
            id="edu-req-cat"
            className="edu-input"
            list="edu-req-cats"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Endodoncia"
            autoComplete="off"
          />
          <datalist id="edu-req-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="edu-field__hint">
            Es la categoría del catálogo de procedimientos. Se compara sin distinguir mayúsculas.
          </p>
        </div>
      )}

      <label className="edu-check">
        <input
          className="edu-check__input"
          type="checkbox"
          checked={onlyCompleted}
          onChange={(e) => setOnlyCompleted(e.target.checked)}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Solo cuentan los casos TERMINADOS</span>
          <span className="edu-check__hint">
            Lo normal. Apágalo si tu escuela mide exposición en vez de resultado: entonces un caso
            suma desde que se abre.
          </span>
        </span>
      </label>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-req-notes">
          Nota (opcional)
        </label>
        <input
          id="edu-req-notes"
          className="edu-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Según el plan 2024, artículo 12"
          autoComplete="off"
        />
      </div>
    </EduModal>
  );
}

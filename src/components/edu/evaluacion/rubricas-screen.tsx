"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_RUBRIC_MAX_CRITERIA,
  EDU_WEIGHT_TOTAL,
  eduRubricWeightCheck,
  type EduRubricRow,
} from "@/lib/edu/evaluacion-core";

/**
 * /instituto/rubricas — CON QUÉ SE CALIFICA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LOS PESOS SUMAN 100 Y SE VALIDA AQUÍ, AL GUARDAR.
 *
 * La pantalla enseña el total mientras se captura y no deja guardar hasta
 * que cierra. El servidor lo vuelve a comprobar —esta pantalla no es la
 * cerradura— pero el momento de descubrir el error tiene que ser éste: si
 * se validara al calificar, saltaría con el paciente ya atendido, el
 * docente de pie y el alumno esperando, y la única salida sería no
 * calificar.
 *
 * 🔴 LA ESCALA LA DECIDE LA ESCUELA. 1–10, 0–100, 0–5: en el código no hay
 * ningún 100 escrito a mano. Se guarda en la rúbrica y se CONGELA en cada
 * calificación, para que subirla mañana no reinterprete lo de ayer.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduRubricasScreenProps {
  rows: EduRubricRow[];
  programs: { id: string; name: string }[];
  procedures: { id: string; name: string; category: string | null }[];
}

interface CriterioUI {
  key: string;
  name: string;
  description: string;
  weight: string;
}

export function EduRubricasScreen({ rows, programs, procedures }: EduRubricasScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [editando, setEditando] = useState<EduRubricRow | null>(null);
  const [creando, setCreando] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  async function alternar(r: EduRubricRow) {
    setBusyId(r.id);
    setError(null);
    try {
      await eduRequest(`/api/instituto/rubricas/${r.id}`, {
        method: "PATCH",
        body: { isActive: !r.isActive },
      });
      recargar(
        r.isActive
          ? `"${r.name}" queda desactivada. Las calificaciones que ya se pusieron con ella no se tocan.`
          : `"${r.name}" vuelve a estar disponible para calificar.`,
      );
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo cambiar la rúbrica.");
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
          {rows.length} {rows.length === 1 ? "rúbrica" : "rúbricas"}
        </span>
        <button
          type="button"
          className="edu-btn edu-btn--primary edu-btn--sm"
          onClick={() => {
            setFlash(null);
            setCreando(true);
          }}
        >
          <Plus size={16} />
          Nueva rúbrica
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay rúbricas</p>
          <p className="edu-empty__detail">
            Una rúbrica es la lista de lo que se mira al calificar un caso, con el peso de cada
            cosa: “Aislamiento 20 %, Conformación 30 %…”. Sin rúbrica no hay criterio compartido, y
            sin criterio una calificación es una opinión.
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--rubricas">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Rúbrica</span>
            <span>Para</span>
            <span>Escala</span>
            <span>Criterios</span>
            <span>Usada en</span>
            <span />
          </div>

          {rows.map((r) => (
            <div key={r.id} className={`edu-row ${r.isActive ? "" : "edu-row--off"}`}>
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Rúbrica</span>
                <span className="edu-cell__value edu-cell__value--strong">{r.name}</span>
                {r.notes && <span className="edu-cell__sub">{r.notes}</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Para</span>
                <span className="edu-cell__value">{r.programName ?? "Todas las especialidades"}</span>
                {r.procedureName && <span className="edu-cell__sub">{r.procedureName}</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Escala</span>
                <span className="edu-cell__value">
                  {r.scaleMin} – {r.scaleMax}
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Criterios</span>
                <span className="edu-cell__value">{r.criteria.length}</span>
                <span className="edu-cell__sub">
                  {r.criteria.map((c) => `${c.name} ${c.weightPercent}%`).join(" · ")}
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Usada en</span>
                <span className="edu-cell__value">
                  {r.usedIn} {r.usedIn === 1 ? "calificación" : "calificaciones"}
                </span>
                {!r.isActive && <span className="edu-tag edu-tag--muted">Desactivada</span>}
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
        <EditorRubrica
          rubrica={editando}
          programs={programs}
          procedures={procedures}
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

function EditorRubrica({
  rubrica,
  programs,
  procedures,
  onClose,
  onDone,
}: {
  rubrica: EduRubricRow | null;
  programs: { id: string; name: string }[];
  procedures: { id: string; name: string; category: string | null }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const contador = useRef(0);
  const [name, setName] = useState(rubrica?.name ?? "");
  const [programId, setProgramId] = useState(rubrica?.programId ?? "");
  const [procedureId, setProcedureId] = useState(rubrica?.procedureId ?? "");
  const [scaleMin, setScaleMin] = useState(String(rubrica?.scaleMin ?? 0));
  const [scaleMax, setScaleMax] = useState(String(rubrica?.scaleMax ?? 10));
  const [notes, setNotes] = useState(rubrica?.notes ?? "");
  const [criterios, setCriterios] = useState<CriterioUI[]>(() => {
    if (rubrica && rubrica.criteria.length > 0) {
      return rubrica.criteria.map((c, i) => ({
        key: `c${i}`,
        name: c.name,
        description: c.description ?? "",
        weight: String(c.weightPercent),
      }));
    }
    return [
      { key: "c0", name: "", description: "", weight: "" },
      { key: "c1", name: "", description: "", weight: "" },
    ];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limpios = useMemo(
    () =>
      criterios
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), weightPercent: Number(c.weight) })),
    [criterios],
  );

  // El mismo validador que corre en el servidor. Aquí solo avisa; ahí es
  // donde cierra la puerta.
  const check = eduRubricWeightCheck(limpios);

  function agregar() {
    if (criterios.length >= EDU_RUBRIC_MAX_CRITERIA) return;
    contador.current += 1;
    setCriterios((cs) => [
      ...cs,
      { key: `n${contador.current}`, name: "", description: "", weight: "" },
    ]);
  }

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        programId: programId || null,
        procedureId: procedureId || null,
        scaleMin: scaleMin.trim(),
        scaleMax: scaleMax.trim(),
        notes: notes.trim() || null,
        criteria: criterios
          .filter((c) => c.name.trim())
          .map((c, i) => ({
            name: c.name.trim(),
            description: c.description.trim() || null,
            weightPercent: c.weight.trim(),
            orderIndex: i + 1,
          })),
      };

      if (rubrica) {
        await eduRequest(`/api/instituto/rubricas/${rubrica.id}`, { method: "PATCH", body });
        onDone(
          `Rúbrica "${body.name}" guardada. Las calificaciones que ya se pusieron con ella conservan sus pesos y su escala: no se recalcula nada.`,
        );
      } else {
        await eduRequest("/api/instituto/rubricas", { method: "POST", body });
        onDone(`Rúbrica "${body.name}" creada.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la rúbrica.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={rubrica ? "Editar la rúbrica" : "Nueva rúbrica"}
      subtitle="Los pesos de los criterios tienen que sumar 100. La escala la decides tú."
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
            disabled={busy || !name.trim() || !check.ok}
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

      {rubrica && rubrica.usedIn > 0 && (
        <div className="edu-banner">
          <div>
            <p className="edu-banner__title">
              Esta rúbrica ya se usó en {rubrica.usedIn}{" "}
              {rubrica.usedIn === 1 ? "calificación" : "calificaciones"}
            </p>
            <p className="edu-banner__detail">
              Cambiarla NO recalcula lo ya calificado: cada calificación guarda el nombre de sus
              criterios, sus pesos y la escala congelados.
            </p>
          </div>
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-rub-name">
          Nombre
        </label>
        <input
          id="edu-rub-name"
          className="edu-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Evaluación clínica de endodoncia"
          autoComplete="off"
        />
      </div>

      <div className="edu-formgrid">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-rub-prog">
            Especialidad
          </label>
          <select
            id="edu-rub-prog"
            className="edu-input"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
          >
            <option value="">Todas</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-rub-proc">
            Procedimiento
          </label>
          <select
            id="edu-rub-proc"
            className="edu-input"
            value={procedureId}
            onChange={(e) => setProcedureId(e.target.value)}
          >
            <option value="">Cualquiera</option>
            {procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.category ? ` · ${p.category}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-rub-min">
            Escala: de
          </label>
          <input
            id="edu-rub-min"
            className="edu-input"
            inputMode="numeric"
            value={scaleMin}
            onChange={(e) => setScaleMin(e.target.value)}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-rub-max">
            hasta
          </label>
          <input
            id="edu-rub-max"
            className="edu-input"
            inputMode="numeric"
            value={scaleMax}
            onChange={(e) => setScaleMax(e.target.value)}
          />
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-rub-notes">
          Para qué es (se lee al calificar)
        </label>
        <input
          id="edu-rub-notes"
          className="edu-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Se usa en los casos de 3º y 4º semestre"
          autoComplete="off"
        />
      </div>

      <div className="edu-section__head">
        <h4 className="edu-section__title">Criterios y pesos</h4>
        <p className="edu-section__lead">
          Tienen que sumar {EDU_WEIGHT_TOTAL}. Enteros: tres criterios “iguales” se capturan
          34/33/33.
        </p>
      </div>

      <div className="edu-stack edu-stack--tight">
        {criterios.map((c, i) => (
          <div key={c.key} className="edu-crit">
            <div className="edu-crit__campos">
              <div className="edu-field">
                <label className="edu-field__label" htmlFor={`edu-crit-n-${c.key}`}>
                  Criterio {i + 1}
                </label>
                <input
                  id={`edu-crit-n-${c.key}`}
                  className="edu-input"
                  value={c.name}
                  onChange={(e) =>
                    setCriterios((cs) =>
                      cs.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="Aislamiento"
                  autoComplete="off"
                />
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor={`edu-crit-p-${c.key}`}>
                  Peso %
                </label>
                <input
                  id={`edu-crit-p-${c.key}`}
                  className="edu-input"
                  inputMode="numeric"
                  value={c.weight}
                  onChange={(e) =>
                    setCriterios((cs) =>
                      cs.map((x) => (x.key === c.key ? { ...x, weight: e.target.value } : x)),
                    )
                  }
                  placeholder="20"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="edu-field">
              <label className="edu-field__label" htmlFor={`edu-crit-d-${c.key}`}>
                Qué se mira (para que dos docentes califiquen lo mismo)
              </label>
              <input
                id={`edu-crit-d-${c.key}`}
                className="edu-input"
                value={c.description}
                onChange={(e) =>
                  setCriterios((cs) =>
                    cs.map((x) => (x.key === c.key ? { ...x, description: e.target.value } : x)),
                  )
                }
                placeholder="Dique colocado antes de abrir, sin filtraciones"
                autoComplete="off"
              />
            </div>
            {criterios.length > 1 && (
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                onClick={() => setCriterios((cs) => cs.filter((x) => x.key !== c.key))}
              >
                <Trash2 size={14} />
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="edu-actions">
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          onClick={agregar}
          disabled={criterios.length >= EDU_RUBRIC_MAX_CRITERIA}
        >
          <Plus size={15} />
          Agregar criterio
        </button>
      </div>

      <div className="edu-totales">
        <div
          className={`edu-totales__fila edu-totales__fila--fuerte ${check.ok ? "" : "edu-totales__fila--mal"}`}
        >
          <span>Suma de los pesos</span>
          <span>
            {check.total} / {EDU_WEIGHT_TOTAL}
          </span>
        </div>
      </div>
      {!check.ok && <p className="edu-note">{check.detail}</p>}
    </EduModal>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_CUESTIONARIO_BLOQUES,
  EDU_CUESTIONARIO_HISTORIAL,
  EDU_CUESTIONARIO_NOTES_MAX,
  EDU_RISK_FLAGS_CRITICAS,
  EDU_RISK_FLAG_LABELS,
  eduCuestionarioDiff,
  eduCuestionarioTexto,
  type EduCuestionarioPregunta,
  type EduRiskFlag,
} from "@/lib/edu/cuestionario-core";
import { EDU_HABIT_LEVELS, EDU_HABIT_LEVEL_LABELS, EDU_PREGNANCY_LABELS, EDU_PREGNANCY_VALUES } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA PESTAÑA «SALUD» — EL CUESTIONARIO VERSIONADO (fila 7 del informe).
 *
 * 🔴 GUARDAR ES CONTESTAR UNA VERSIÓN NUEVA, NUNCA EDITAR LA VIGENTE. No
 * hay botón de «editar» y no es un olvido: la pregunta clínica no es «¿qué
 * contesta el paciente?», es «¿QUÉ CONTESTÓ ANTES DE LA EXTRACCIÓN?», y un
 * update la deja sin respuesta para siempre. Por eso el botón dice
 * «Contestar de nuevo» y el formulario nace PRECARGADO con lo que se
 * contestó la última vez: la mayoría de las respuestas no cambian y
 * volverlas a teclear es cómo se llega a que nadie lo actualice.
 *
 * 🔴 LAS BANDERAS LAS CALCULA EL SERVIDOR. Esta pantalla no deriva ni una:
 * las pinta como llegan. Una bandera que calcula el navegador es una
 * bandera que el navegador puede no calcular.
 *
 * 🔴 LAS PREGUNTAS SON UN DATO (`EDU_CUESTIONARIO_BLOQUES`), no JSX. Las
 * CLAVES son las que el servidor mira para encender banderas y para
 * mezclar la ficha; tecleadas aquí, un singular de más las apaga en
 * silencio. Ver la cabecera del core.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduCuestionarioVersionRow {
  id: string;
  version: number;
  answers: unknown;
  riskFlags: string[];
  notes: string | null;
  recordedByName: string;
  /** Ya escrito por el SERVIDOR en la zona del instituto. */
  recordedLabel: string;
}

export interface EduCuestionarioScreenProps {
  patientId: string;
  rows: EduCuestionarioVersionRow[];
  /** true = hay más de 20 versiones y esta lista se cortó. */
  truncated: boolean;
  canEdit: boolean;
  /** El motivo escrito de por qué NO se puede contestar, si no se puede. */
  motivoSinPermiso: string;
}

type Respuestas = Record<string, unknown>;

export function EduCuestionarioScreen({
  patientId,
  rows,
  truncated,
  canEdit,
  motivoSinPermiso,
}: EduCuestionarioScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const vigente = rows[0] ?? null;

  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [comparando, setComparando] = useState<string | null>(null);

  // El formulario nace con lo de la versión vigente. `useState` con
  // inicializador y no un `useEffect` que lo "corrija" después: lo segundo
  // pintaría un formulario vacío durante un fotograma y pisaría lo que la
  // persona acabara de teclear en cada re-render.
  const [resp, setResp] = useState<Respuestas>(() => ({
    ...((vigente?.answers as Respuestas | null) ?? {}),
  }));
  const [notas, setNotas] = useState("");

  function set(clave: string, valor: unknown) {
    setResp((prev) => ({ ...prev, [clave]: valor }));
  }

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const r = await eduRequest<{ version: number; riskFlags: EduRiskFlag[] }>(
        `/api/instituto/pacientes/${patientId}/cuestionario`,
        { method: "POST", body: { answers: resp, notes: notas.trim() || undefined } },
      );
      setAbierto(false);
      setNotas("");
      setFlash(
        `Quedó guardada la versión ${r.version}. ${
          r.riskFlags.length === 0
            ? "No encendió ninguna bandera de riesgo."
            : `Encendió ${r.riskFlags.length} ${
                r.riskFlags.length === 1 ? "bandera" : "banderas"
              }: ${r.riskFlags.map((f) => EDU_RISK_FLAG_LABELS[f] ?? f).join(", ")}.`
        }`,
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el cuestionario.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edu-stack">
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

      {/* ── LA VERSIÓN VIGENTE ──────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Cuestionario de salud</h2>
            <p className="edu-section__lead">
              {vigente
                ? `Vigente: versión ${vigente.version}, la contestó ${vigente.recordedByName} el ${vigente.recordedLabel}.`
                : "Todavía no se le ha hecho ninguno. Lo que se conteste queda como la versión 1."}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => {
                setFlash(null);
                setError(null);
                setAbierto((v) => !v);
              }}
            >
              {abierto ? "Cerrar" : vigente ? "Contestar de nuevo" : "Contestar el cuestionario"}
            </button>
          ) : (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled
              title={motivoSinPermiso}
            >
              Contestar de nuevo
            </button>
          )}
        </div>

        {!canEdit && <p className="edu-note">{motivoSinPermiso}</p>}

        {/* Las banderas de la versión vigente. Las CRÍTICAS primero y en
            rojo: el orden ES la lectura, y quien está de pie con el
            paciente en el sillón lee la primera línea y a veces solo ésa.
            El orden llega ya resuelto del servidor. */}
        {vigente && vigente.riskFlags.length > 0 && (
          <div className="edu-fichahero__chips" role="group" aria-label="Banderas de riesgo">
            {vigente.riskFlags.map((f) => {
              const critica = (EDU_RISK_FLAGS_CRITICAS as string[]).includes(f);
              return (
                <span
                  key={f}
                  className={`edu-tag ${critica ? "edu-tag--danger" : "edu-tag--warn"}`}
                  title={
                    critica
                      ? "Bandera crítica: se lee antes de infiltrar un anestésico o de sacar una pieza."
                      : "A tener en cuenta durante el tratamiento."
                  }
                >
                  <AlertTriangle size={12} strokeWidth={1.75} aria-hidden />
                  {EDU_RISK_FLAG_LABELS[f as EduRiskFlag] ?? f}
                </span>
              );
            })}
          </div>
        )}
        {vigente && vigente.riskFlags.length === 0 && (
          <p className="edu-note">
            La versión vigente no encendió ninguna bandera de riesgo. Eso NO es «no tiene nada»:
            es «esto es lo que contestó el {vigente.recordedLabel}».
          </p>
        )}

        {vigente && (
          <div className="edu-kv">
            {EDU_CUESTIONARIO_BLOQUES.flatMap((b) => b.preguntas).map((p) => (
              <div key={p.clave}>
                <span className="edu-kv__k">{p.etiqueta}</span>
                <span className="edu-kv__v">
                  {eduCuestionarioTexto((vigente.answers as Respuestas | null)?.[p.clave])}
                </span>
              </div>
            ))}
          </div>
        )}
        {vigente?.notes && <p className="edu-note">Nota de quien lo capturó: {vigente.notes}</p>}
      </section>

      {/* ── EL FORMULARIO, POR BLOQUES ──────────────────────────────── */}
      {abierto && canEdit && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Contestar una versión nueva</h2>
              <p className="edu-section__lead">
                Viene precargado con lo que se contestó la última vez: corrige lo que cambió. Al
                guardar se crea una versión NUEVA — la anterior no se toca, y sigue siendo la
                respuesta a «¿qué contestó antes de la extracción?».
              </p>
            </div>
          </div>

          {EDU_CUESTIONARIO_BLOQUES.map((b) => (
            <div key={b.id} className="edu-fichab-grupo">
              <p className="edu-fichab-grupo__title">{b.titulo}</p>
              <p className="edu-fichab-grupo__lead">{b.lead}</p>
              <div className="edu-formgrid">
                {b.preguntas.map((p) => (
                  <Campo
                    key={p.clave}
                    pregunta={p}
                    valor={resp[p.clave]}
                    onChange={(v) => set(p.clave, v)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-cuest-notas">
              Nota de quien captura (opcional)
            </label>
            <textarea
              id="edu-cuest-notas"
              className="edu-input"
              rows={2}
              maxLength={EDU_CUESTIONARIO_NOTES_MAX}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej.: lo contestó la madre; el paciente no recuerda el nombre del anticoagulante."
            />
          </div>

          <p className="edu-note">
            Lo clínico se MEZCLA en la ficha del paciente: las alergias, los padecimientos y la
            medicación se SUMAN a las que ya tenía. Contestar a medias no le borra nada a nadie.
          </p>

          <div className="edu-form-acciones">
            <button
              type="button"
              className="edu-btn edu-btn--primary"
              onClick={guardar}
              disabled={busy}
            >
              {busy ? "Guardando…" : "Guardar esta versión"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--quiet"
              onClick={() => setAbierto(false)}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {/* ── EL HISTORIAL, CON DIFF ──────────────────────────────────── */}
      {rows.length > 0 && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Historial</h2>
            <span className="edu-count">{rows.length}</span>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => setVerHistorial((v) => !v)}
              aria-expanded={verHistorial}
            >
              {verHistorial ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
              {verHistorial ? "Ocultar" : "Ver las versiones"}
            </button>
          </div>

          {truncated && (
            <div className="edu-banner edu-banner--warn" role="status">
              <div>
                <p className="edu-banner__title">
                  Este paciente tiene más de {EDU_CUESTIONARIO_HISTORIAL} versiones.
                </p>
                <p className="edu-banner__detail">
                  Se enseñan las {EDU_CUESTIONARIO_HISTORIAL} más recientes. Las anteriores{" "}
                  <strong>no se borran</strong> y siguen siendo el expediente: el tope es de
                  lectura, no de guardado.
                </p>
              </div>
            </div>
          )}

          {verHistorial && (
            <div className="edu-stack edu-stack--tight">
              {rows.map((v, i) => {
                const anterior = rows[i + 1] ?? null;
                const cambios = anterior
                  ? eduCuestionarioDiff(v.answers as Respuestas, anterior.answers as Respuestas)
                  : [];
                const abiertoAqui = comparando === v.id;
                return (
                  <article key={v.id} className="edu-nota">
                    <div className="edu-nota__head">
                      <div>
                        <span className="edu-nota__when">Versión {v.version}</span>
                        <span className="edu-nota__who">
                          {v.recordedByName} · {v.recordedLabel}
                        </span>
                      </div>
                      {i === 0 && <span className="edu-tag edu-tag--ok">Vigente</span>}
                    </div>

                    {v.riskFlags.length > 0 && (
                      <p className="edu-estudio__meta">
                        Banderas:{" "}
                        {v.riskFlags
                          .map((f) => EDU_RISK_FLAG_LABELS[f as EduRiskFlag] ?? f)
                          .join(" · ")}
                      </p>
                    )}
                    {v.notes && <p className="edu-estudio__meta">“{v.notes}”</p>}

                    {anterior ? (
                      <>
                        <div className="edu-receta__acciones">
                          <button
                            type="button"
                            className="edu-btn edu-btn--ghost edu-btn--sm"
                            onClick={() => setComparando(abiertoAqui ? null : v.id)}
                          >
                            {abiertoAqui
                              ? "Ocultar los cambios"
                              : `Qué cambió respecto a la ${anterior.version} (${cambios.length})`}
                          </button>
                        </div>
                        {abiertoAqui &&
                          (cambios.length === 0 ? (
                            <p className="edu-note">
                              No cambió ni una respuesta respecto a la versión {anterior.version}.
                              La versión existe igual: es constancia de que el {v.recordedLabel} se
                              volvió a preguntar.
                            </p>
                          ) : (
                            <div className="edu-tablewrap">
                              <div className="edu-table">
                                <div className="edu-rowhead" aria-hidden="true">
                                  <span>Pregunta</span>
                                  <span>Antes</span>
                                  <span>Después</span>
                                </div>
                                {cambios.map((c) => (
                                  <div key={c.clave} className="edu-row">
                                    <div className="edu-cell edu-cell--wide">
                                      <span className="edu-cell__label">Pregunta</span>
                                      <span className="edu-cell__value edu-cell__value--strong">
                                        {c.etiqueta}
                                      </span>
                                    </div>
                                    <div className="edu-cell">
                                      <span className="edu-cell__label">Antes</span>
                                      <span className="edu-cell__value">{c.antes}</span>
                                    </div>
                                    <div className="edu-cell">
                                      <span className="edu-cell__label">Después</span>
                                      <span className="edu-cell__value">{c.despues}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                      </>
                    ) : (
                      <p className="edu-note">
                        Es la primera versión: no hay nada anterior con lo que compararla.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// UN CAMPO — la forma la decide el TIPO de la pregunta, no el JSX
// ═══════════════════════════════════════════════════════════════════════

function Campo({
  pregunta,
  valor,
  onChange,
}: {
  pregunta: EduCuestionarioPregunta;
  valor: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `edu-cuest-${pregunta.clave}`;
  const texto = typeof valor === "string" ? valor : valor === undefined || valor === null ? "" : String(valor);

  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={id}>
        {pregunta.etiqueta}
        {pregunta.critica && (
          <span className="edu-tag edu-tag--danger" title="Enciende una bandera crítica.">
            crítica
          </span>
        )}
      </label>

      {pregunta.tipo === "SI_NO" && (
        <select
          id={id}
          className="edu-input edu-input--sm"
          value={valor === true ? "si" : valor === false ? "no" : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "si")}
        >
          {/* 🔴 «Sin contestar» NO es «no». Es la misma distinción que la
              ficha ya hace con `historyRecordedAt`, y confundirlas es como
              se mata a alguien: un anticoagulante sin preguntar y un
              anticoagulante negado se ven igual en una tabla y no son lo
              mismo delante del sillón. */}
          <option value="">Sin contestar</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      )}

      {pregunta.tipo === "HABITO" && (
        <select
          id={id}
          className="edu-input edu-input--sm"
          value={texto}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Sin contestar</option>
          {EDU_HABIT_LEVELS.map((h) => (
            <option key={h} value={h}>
              {EDU_HABIT_LEVEL_LABELS[h]}
            </option>
          ))}
        </select>
      )}

      {pregunta.tipo === "EMBARAZO" && (
        <select
          id={id}
          className="edu-input edu-input--sm"
          value={texto}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Sin contestar</option>
          {EDU_PREGNANCY_VALUES.map((v) => (
            <option key={v} value={v}>
              {EDU_PREGNANCY_LABELS[v]}
            </option>
          ))}
        </select>
      )}

      {(pregunta.tipo === "TEXTO" || pregunta.tipo === "LISTA") && (
        <input
          id={id}
          className="edu-input edu-input--sm"
          type="text"
          value={texto}
          maxLength={500}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={pregunta.tipo === "LISTA" ? "Sepáralos con comas" : ""}
        />
      )}

      {pregunta.ayuda && <span className="edu-field__hint">{pregunta.ayuda}</span>}
    </div>
  );
}

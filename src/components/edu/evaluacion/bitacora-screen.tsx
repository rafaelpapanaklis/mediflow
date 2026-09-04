"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Download, GraduationCap } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { EduPersonaLink, useEduPersonaLinks } from "@/components/edu/persona/persona-link";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_ATRASO_DESCRIPTIONS,
  EDU_ATRASO_LABELS,
  eduScoreLabel,
  type EduAtrasoEstado,
  type EduBitacoraPage,
  type EduGradeRow,
  type EduRubricRow,
} from "@/lib/edu/evaluacion-core";
import { EDU_CASE_STATUS_LABELS, type EduCaseStatus } from "@/lib/edu/types";

/**
 * /instituto/evaluacion/[id] — LA BITÁCORA ACADÉMICA DE UN ALUMNO.
 *
 * Su historia en una pantalla: qué le falta, cuántas horas lleva, sus
 * casos, sus calificaciones y sus traspasos. Es lo que la dirección enseña
 * en una acreditación, así que se puede EXPORTAR (el botón de arriba baja
 * un CSV que se abre en una hoja de cálculo y se suma).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ALUMNO ABRE ESTA MISMA PANTALLA Y VE LA SUYA. Sin botones de
 * calificar (esconderlos no cierra nada: lo que cierra es el permiso del
 * endpoint) y con el mismo detalle de lo que le falta. Que pueda leer
 * "te faltan 3 de 8" y los comentarios de su docente es la mitad de para
 * qué existe esta ola.
 *
 * 🔴 CORREGIR UNA CALIFICACIÓN NO LA REESCRIBE. El botón "Corregir" abre
 * el mismo formulario y guarda una calificación NUEVA que apunta a la
 * anterior; las dos quedan en la lista, la vieja marcada como corregida y
 * con el nombre de quien la puso. Es la misma regla que la nota firmada
 * del expediente.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduBitacoraScreenProps {
  page: EduBitacoraPage;
  rubrics: EduRubricRow[];
  canGrade: boolean;
  canTransfer: boolean;
  /** Alumnos ACTIVOS a los que se puede traspasar (misma especialidad). */
  destinos: { id: string; name: string; matricula: string; programId: string }[];
  /** Los casos abiertos, con cuántas citas futuras traen. */
  traspasables: {
    id: string;
    patientName: string;
    patientFolio: string;
    programId: string;
    programName: string;
    procedureName: string | null;
    status: string;
    upcomingAppointments: number;
  }[];
  /** true = quien mira es el propio alumno. */
  esPropia: boolean;
}

const TAG_BY_ESTADO: Record<EduAtrasoEstado, string> = {
  AL_DIA: "edu-tag--ok",
  VIGILAR: "edu-tag--warn",
  ATRASADO: "edu-tag--danger",
};

const TAG_BY_CASE: Record<EduCaseStatus, string> = {
  SCREENING: "edu-tag--info",
  ASSIGNED: "edu-tag--info",
  IN_TREATMENT: "edu-tag--warn",
  ON_HOLD: "edu-tag--muted",
  COMPLETED: "edu-tag--ok",
  TRANSFERRED: "edu-tag--muted",
  ABANDONED: "edu-tag--muted",
};

export function EduBitacoraScreen({
  page,
  rubrics,
  canGrade,
  canTransfer,
  destinos,
  traspasables,
  esPropia,
}: EduBitacoraScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [calificando, setCalificando] = useState<{
    caseId: string;
    patientName: string;
    corrige: EduGradeRow | null;
  } | null>(null);
  const [traspasando, setTraspasando] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // Los mismos booleanos que usa EduPersonaLink, para esconder la ACCIÓN
  // "Ver su ficha" cuando no hay ficha que abrir.
  const personaLinks = useEduPersonaLinks();

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  const verdict = page.verdict;
  const abiertos = page.cases.filter(
    (c) => c.status !== "COMPLETED" && c.status !== "TRANSFERRED" && c.status !== "ABANDONED",
  );

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      {/* ── Quién es, y cómo va ─────────────────────────────────────── */}
      <div className="edu-fichahead">
        <div>
          <span className="edu-fichahead__folio">{page.matricula}</span>
          <h2 className="edu-fichahead__name">{page.studentName}</h2>
          <p className="edu-fichahead__meta">
            {page.programName} · {page.cohortName} · {page.semester}º semestre · {page.statusLabel}
          </p>
          <p className="edu-fichahead__meta">
            {page.cohortStartLabel && page.cohortEndLabel
              ? `Ciclo del ${page.cohortStartLabel} al ${page.cohortEndLabel}`
              : "A su generación le faltan fechas: sin ellas no se puede calcular si va atrasado."}
          </p>
        </div>
        {/* Esta bitácora es la de evaluación (casos, calificaciones); la
            ficha académica (matrícula, generación, docente supervisor) vive
            en /instituto/estudiantes/{id}.

            ⚠️ El BOTÓN se esconde con el mismo booleano que decide el
            enlace, y hay que preguntarlo aparte: EduPersonaLink sin permiso
            NO desaparece, devuelve `children` en texto plano — que aquí
            dejaría un "Ver su ficha" suelto, con pinta de rótulo huérfano y
            sin nada que hacer. La regla del componente (pintar el nombre
            aunque no enlace) es la correcta para un NOMBRE y la equivocada
            para una ACCIÓN, y por eso existe useEduPersonaLinks. */}
        {personaLinks.estudiante && (
          <EduPersonaLink
            kind="estudiante"
            id={page.studentId}
            className="edu-btn edu-btn--ghost edu-btn--sm"
          >
            Ver su ficha
          </EduPersonaLink>
        )}
      </div>

      <div className="edu-kpis">
        <div className="edu-kpi">
          <span className="edu-kpi__label">Cómo va</span>
          <span className="edu-kpi__value">
            {verdict.estado ? (
              <span
                className={`edu-tag ${TAG_BY_ESTADO[verdict.estado]}`}
                title={EDU_ATRASO_DESCRIPTIONS[verdict.estado]}
              >
                {EDU_ATRASO_LABELS[verdict.estado]}
              </span>
            ) : (
              <span className="edu-tag edu-tag--muted">Sin calcular</span>
            )}
          </span>
          <span className="edu-kpi__note">{verdict.motivo}</span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Requisitos</span>
          <span className="edu-kpi__value">
            {verdict.hechos} / {verdict.totales}
          </span>
          <span className="edu-kpi__note">
            {verdict.fraccion === null
              ? "sin fechas de generación"
              : `se esperan ${eduScoreLabel(Math.round(verdict.esperados * 100))} a esta altura`}
          </span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Horas clínicas</span>
          <span className="edu-kpi__value">{page.hoursLabel}</span>
          <span className="edu-kpi__note">
            {page.hours.appointments} citas terminadas
            {page.hours.estimatedAppointments > 0
              ? ` · ${page.hours.estimatedAppointments} sin sello de inicio (se usó la duración agendada)`
              : ""}
            {page.hours.cappedAppointments > 0
              ? ` · ${page.hours.cappedAppointments} recortadas al tope de 8 h: alguien las cerró tarde`
              : ""}
          </span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Promedio</span>
          <span className="edu-kpi__value">
            {page.averageLabel ? `${page.averageLabel} / ${page.averageScaleMax}` : "—"}
          </span>
          <span className="edu-kpi__note">
            {page.grades.filter((g) => g.current).length} casos calificados
          </span>
        </div>
      </div>

      <div className="edu-actions">
        <a
          className="edu-btn edu-btn--ghost edu-btn--sm"
          href={`/api/instituto/evaluacion/${page.studentId}/export`}
        >
          <Download size={15} />
          Exportar la bitácora
        </a>
        {canTransfer && traspasables.length > 0 && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setTraspasando(true);
            }}
          >
            <ArrowLeftRight size={15} />
            Traspasar casos ({traspasables.length})
          </button>
        )}
      </div>

      {/* ── Lo que le falta ─────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">
            {esPropia ? "Lo que te falta" : "Requisitos del plan de estudios"}
          </h3>
        </div>
        {page.requirements.length === 0 ? (
          <p className="edu-note">
            Su especialidad todavía no tiene requisitos capturados, así que no hay nada contra qué
            medir el avance. Se capturan en Requisitos.
          </p>
        ) : (
          <div className="edu-stack">
            {page.requirements.map((r) => {
              const pct = r.requiredCount > 0 ? Math.min(100, (r.doneCount / r.requiredCount) * 100) : 0;
              return (
                <div key={r.requirementId} className={`edu-req ${r.met ? "edu-req--ok" : ""}`}>
                  <div className="edu-req__head">
                    <span className="edu-req__name">{r.name}</span>
                    <span className="edu-req__num">
                      {r.doneCount} / {r.requiredCount}
                    </span>
                  </div>
                  <div className="edu-progreso" role="presentation">
                    <span className="edu-progreso__bar" style={{ width: `${pct}%` }} />
                    {r.expectedCount > 0 && r.requiredCount > 0 && (
                      // La marca de lo ESPERADO a esta altura del ciclo. Sin
                      // ella, la barra dice "vas por la mitad" y no dice si
                      // media barra a mitad de ciclo está bien o está mal.
                      <span
                        className="edu-progreso__meta"
                        style={{
                          left: `${Math.min(100, (r.expectedCount / r.requiredCount) * 100)}%`,
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <p className="edu-req__detail">{r.detail}</p>
                </div>
              );
            })}
          </div>
        )}
        {page.casesWithoutProcedure > 0 && (
          <p className="edu-note">
            ⚠️ {page.casesWithoutProcedure}{" "}
            {page.casesWithoutProcedure === 1
              ? "caso no tiene procedimiento capturado y no cuenta"
              : "casos no tienen procedimiento capturado y no cuentan"}{" "}
            para los requisitos que piden uno. Se captura en el caso, desde la ficha del paciente.
          </p>
        )}
      </section>

      {/* ── Los casos ───────────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">Casos ({page.cases.length})</h3>
          <p className="edu-section__lead">
            {abiertos.length} {abiertos.length === 1 ? "abierto" : "abiertos"}
          </p>
        </div>

        {page.cases.length === 0 ? (
          <p className="edu-note">Todavía no tiene ningún caso asignado.</p>
        ) : (
          <div className="edu-table edu-table--bitacora">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Paciente</span>
              <span>Procedimiento</span>
              <span>Estado</span>
              <span>Abierto</span>
              <span>Calificación</span>
              <span />
            </div>
            {page.cases.map((c) => (
              <div
                key={c.id}
                className={`edu-row ${c.status === "TRANSFERRED" ? "edu-row--off" : ""}`}
              >
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Paciente</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    <EduPersonaLink kind="paciente" id={c.patientId}>
                      {c.patientName}
                    </EduPersonaLink>
                  </span>
                  <span className="edu-cell__sub">
                    {c.patientFolio} · {c.programName}
                    {c.transferredFromCaseId ? " · viene de un traspaso" : ""}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Procedimiento</span>
                  <span className="edu-cell__value">
                    {c.procedureName ?? <em className="edu-sin">sin capturar</em>}
                  </span>
                  {c.procedureCategory && (
                    <span className="edu-cell__sub">{c.procedureCategory}</span>
                  )}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span className={`edu-tag ${TAG_BY_CASE[c.status]}`}>
                    {EDU_CASE_STATUS_LABELS[c.status]}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Abierto</span>
                  <span className="edu-cell__value">{c.openedLabel}</span>
                  {c.closedLabel && (
                    <span className="edu-cell__sub">cerrado el {c.closedLabel}</span>
                  )}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Calificación</span>
                  <span className="edu-cell__value edu-precio">
                    {c.gradeLabel ? `${c.gradeLabel} / ${c.gradeScaleMax}` : "—"}
                  </span>
                </div>

                <div className="edu-cell__actions">
                  <Link
                    href={`/instituto/pacientes/${encodeURIComponent(c.patientId)}`}
                    className="edu-btn edu-btn--quiet edu-btn--sm"
                    prefetch={false}
                  >
                    Ficha
                  </Link>
                  {canGrade && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setCalificando({
                          caseId: c.id,
                          patientName: c.patientName,
                          corrige: null,
                        });
                      }}
                    >
                      <GraduationCap size={15} />
                      {c.gradeLabel ? "Calificar otra vez" : "Calificar"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Las calificaciones ──────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">Calificaciones ({page.grades.length})</h3>
        </div>

        {page.grades.length === 0 ? (
          <p className="edu-note">
            {esPropia
              ? "Todavía no te han calificado ningún caso."
              : "Todavía no se le ha calificado ningún caso."}
          </p>
        ) : (
          <div className="edu-stack">
            {page.grades.map((g) => (
              <article key={g.id} className={`edu-cal ${g.current ? "" : "edu-cal--vieja"}`}>
                <div className="edu-cal__head">
                  <div>
                    <p className="edu-cal__quien">
                      {g.patientName}{" "}
                      <span className="edu-cal__folio">{g.patientFolio}</span>
                    </p>
                    <p className="edu-cal__meta">
                      {g.rubricName} · {g.gradedLabel} · calificó {g.gradedByName}
                      {g.correctsId ? " · es una corrección" : ""}
                    </p>
                  </div>
                  <div className="edu-cal__nota">
                    <span className="edu-cal__valor">{g.finalScoreLabel}</span>
                    <span className="edu-cal__escala">/ {g.scaleMax}</span>
                  </div>
                </div>

                {!g.current && (
                  <p className="edu-cal__aviso">
                    Corregida más tarde. Se conserva a propósito: una calificación guardada no se
                    edita en silencio.
                  </p>
                )}

                <dl className="edu-cal__campos">
                  {g.items.map((it) => (
                    <div key={it.id} className="edu-cal__campo">
                      <dt className="edu-cal__campodt">
                        {it.criterionName} <span className="edu-cal__peso">{it.weightPercent} %</span>
                      </dt>
                      <dd className="edu-cal__campodd">
                        <strong>{it.scoreLabel}</strong>
                        {it.comment ? ` — ${it.comment}` : ""}
                      </dd>
                    </div>
                  ))}
                </dl>

                {g.comment && <p className="edu-cal__comentario">{g.comment}</p>}

                {canGrade && g.current && (
                  <div className="edu-actions">
                    <button
                      type="button"
                      className="edu-btn edu-btn--quiet edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setCalificando({
                          caseId: g.caseId,
                          patientName: g.patientName,
                          corrige: g,
                        });
                      }}
                    >
                      Corregir
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Los traspasos ───────────────────────────────────────────── */}
      {page.transfers.length > 0 && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h3 className="edu-section__title">Traspasos ({page.transfers.length})</h3>
            <p className="edu-section__lead">
              Un caso traspasado no se reasigna: el viejo se cierra y se abre uno nuevo que apunta a
              él. El expediente de cada uno se queda donde ocurrió.
            </p>
          </div>
          <div className="edu-stack edu-stack--tight">
            {page.transfers.map((t) => (
              <div key={t.caseId} className="edu-traspaso">
                <p className="edu-traspaso__linea">
                  <strong>{t.patientName}</strong> <span className="edu-cal__folio">{t.patientFolio}</span>{" "}
                  · {t.programName}
                </p>
                <p className="edu-traspaso__meta">
                  <EduPersonaLink kind="estudiante" id={t.fromStudentId}>
                    {t.fromStudentName}
                  </EduPersonaLink>{" "}
                  →{" "}
                  <EduPersonaLink kind="estudiante" id={t.toStudentId}>
                    {t.toStudentName}
                  </EduPersonaLink>{" "}
                  · {t.atLabel}
                  {t.byName ? ` · lo hizo ${t.byName}` : ""}
                </p>
                {t.reason && <p className="edu-traspaso__motivo">{t.reason}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {calificando && (
        <Calificar
          caseId={calificando.caseId}
          patientName={calificando.patientName}
          corrige={calificando.corrige}
          rubrics={rubrics}
          onClose={() => setCalificando(null)}
          onDone={(msg) => {
            setCalificando(null);
            recargar(msg);
          }}
        />
      )}

      {traspasando && (
        <Traspasar
          casos={traspasables}
          destinos={destinos}
          desde={page.studentName}
          onClose={() => setTraspasando(false)}
          onDone={(msg) => {
            setTraspasando(false);
            recargar(msg);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CALIFICAR — rúbrica → una puntuación por criterio → la final la calcula
// el SERVIDOR
// ═══════════════════════════════════════════════════════════════════════

function Calificar({
  caseId,
  patientName,
  corrige,
  rubrics,
  onClose,
  onDone,
}: {
  caseId: string;
  patientName: string;
  corrige: EduGradeRow | null;
  rubrics: EduRubricRow[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const activas = useMemo(() => rubrics.filter((r) => r.isActive), [rubrics]);
  const [rubricId, setRubricId] = useState(
    corrige?.rubricId && activas.some((r) => r.id === corrige.rubricId)
      ? corrige.rubricId
      : (activas[0]?.id ?? ""),
  );
  const rubrica = activas.find((r) => r.id === rubricId) ?? null;

  const [scores, setScores] = useState<Record<string, string>>(() => {
    // Al corregir se precargan las puntuaciones anteriores: nadie recuerda
    // qué le puso en "Aislamiento" hace tres semanas, y una corrección que
    // obliga a recapturarlo todo se convierte en una corrección que no se
    // hace.
    const base: Record<string, string> = {};
    for (const it of corrige?.items ?? []) {
      if (it.criterionId) base[it.criterionId] = eduScoreLabel(it.scoreX100);
    }
    return base;
  });
  const [comentarios, setComentarios] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    for (const it of corrige?.items ?? []) {
      if (it.criterionId && it.comment) base[it.criterionId] = it.comment;
    }
    return base;
  });
  const [comment, setComment] = useState(corrige?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔴 Esta suma es SOLO para que el docente vea la nota moverse mientras
  // captura. La que vale la calcula el servidor con los pesos guardados: si
  // el navegador supiera calcular una calificación, sabría calcular una
  // mejor.
  const preview = useMemo(() => {
    if (!rubrica) return null;
    let puntos = 0;
    let pesos = 0;
    let completos = true;
    for (const c of rubrica.criteria) {
      const raw = (scores[c.id] ?? "").trim().replace(",", ".");
      const v = Number(raw);
      if (!raw || !Number.isFinite(v)) {
        completos = false;
        continue;
      }
      puntos += Math.round(v * 100) * c.weightPercent;
      pesos += c.weightPercent;
    }
    if (pesos <= 0) return null;
    return { valor: Math.round(puntos / pesos), completos };
  }, [rubrica, scores]);

  async function guardar() {
    if (!rubrica) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ finalScoreX100: number }>(
        "/api/instituto/calificaciones",
        {
          method: "POST",
          body: {
            caseId,
            rubricId: rubrica.id,
            comment: comment.trim() || null,
            correctsId: corrige?.id ?? undefined,
            items: rubrica.criteria.map((c) => ({
              criterionId: c.id,
              score: scores[c.id] ?? "",
              comment: comentarios[c.id]?.trim() || null,
            })),
          },
        },
      );
      onDone(
        corrige
          ? `Calificación corregida: ${eduScoreLabel(res.finalScoreX100)} / ${rubrica.scaleMax}. La anterior queda en el historial con tu nombre.`
          : `Calificado: ${eduScoreLabel(res.finalScoreX100)} / ${rubrica.scaleMax}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calificar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={corrige ? "Corregir la calificación" : "Calificar"}
      subtitle={`${patientName} · la calificación final la calcula el sistema con los pesos de la rúbrica`}
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
            disabled={busy || !rubrica}
          >
            {busy ? "Guardando…" : corrige ? "Guardar la corrección" : "Guardar la calificación"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {corrige && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">Esto NO reescribe la calificación anterior</p>
            <p className="edu-banner__detail">
              Se guarda una nueva que apunta a la de {corrige.gradedLabel}. Las dos quedan
              visibles, con quién las puso y cuándo.
            </p>
          </div>
        </div>
      )}

      {activas.length === 0 ? (
        <p className="edu-note">
          No hay ninguna rúbrica activa. La dirección las captura en Rúbricas: sin rúbrica no hay
          criterio, y sin criterio una calificación es una opinión.
        </p>
      ) : (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-cal-rub">
              Rúbrica
            </label>
            <select
              id="edu-cal-rub"
              className="edu-input"
              value={rubricId}
              onChange={(e) => {
                setRubricId(e.target.value);
                setScores({});
                setComentarios({});
              }}
            >
              {activas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.scaleMin}–{r.scaleMax})
                  {r.procedureName ? ` · ${r.procedureName}` : ""}
                </option>
              ))}
            </select>
            {rubrica?.notes && <p className="edu-field__hint">{rubrica.notes}</p>}
          </div>

          {rubrica && (
            <>
              <div className="edu-stack edu-stack--tight">
                {rubrica.criteria.map((c) => (
                  <div key={c.id} className="edu-crit">
                    <div className="edu-crit__head">
                      <span className="edu-crit__name">{c.name}</span>
                      <span className="edu-crit__peso">{c.weightPercent} %</span>
                    </div>
                    {c.description && <p className="edu-crit__desc">{c.description}</p>}
                    <div className="edu-crit__campos">
                      <div className="edu-field">
                        <label className="edu-field__label" htmlFor={`edu-cal-${c.id}`}>
                          Puntuación ({rubrica.scaleMin}–{rubrica.scaleMax})
                        </label>
                        <input
                          id={`edu-cal-${c.id}`}
                          className="edu-input"
                          inputMode="decimal"
                          value={scores[c.id] ?? ""}
                          onChange={(e) =>
                            setScores((s) => ({ ...s, [c.id]: e.target.value }))
                          }
                          placeholder={`${rubrica.scaleMax}`}
                          autoComplete="off"
                        />
                      </div>
                      <div className="edu-field">
                        <label className="edu-field__label" htmlFor={`edu-cal-c-${c.id}`}>
                          Comentario
                        </label>
                        <input
                          id={`edu-cal-c-${c.id}`}
                          className="edu-input"
                          value={comentarios[c.id] ?? ""}
                          onChange={(e) =>
                            setComentarios((s) => ({ ...s, [c.id]: e.target.value }))
                          }
                          placeholder="Qué vio, en una línea"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="edu-totales">
                <div className="edu-totales__fila edu-totales__fila--fuerte">
                  <span>Calificación final</span>
                  <span>
                    {preview
                      ? `${eduScoreLabel(preview.valor)} / ${rubrica.scaleMax}${preview.completos ? "" : " (faltan criterios)"}`
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-cal-com">
                  Comentario para el estudiante
                </label>
                <textarea
                  id="edu-cal-com"
                  className="edu-textarea"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Lo que tiene que corregir la próxima vez. Un número sin comentario no enseña nada."
                />
              </div>
            </>
          )}
        </>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRASPASAR — elegir casos, elegir a quién, y decir por qué
// ═══════════════════════════════════════════════════════════════════════

function Traspasar({
  casos,
  destinos,
  desde,
  onClose,
  onDone,
}: {
  casos: EduBitacoraScreenProps["traspasables"];
  destinos: EduBitacoraScreenProps["destinos"];
  desde: string;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [elegidos, setElegidos] = useState<string[]>(casos.map((c) => c.id));
  const [toStudentId, setToStudentId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallidos, setFallidos] = useState<{ caseId: string; error: string }[]>([]);

  async function traspasar() {
    setError(null);
    setFallidos([]);
    setBusy(true);
    try {
      const res = await eduRequest<{
        traspasados: { id: string }[];
        fallidos: { caseId: string; error: string }[];
      }>("/api/instituto/traspasos/lote", {
        method: "POST",
        body: {
          toStudentId,
          reason: reason.trim() || null,
          items: elegidos.map((caseId) => ({ caseId })),
        },
      });
      if (res.fallidos.length > 0) {
        setFallidos(res.fallidos);
        setBusy(false);
        if (res.traspasados.length === 0) {
          setError("No se pudo traspasar ninguno. Mira el detalle de abajo.");
          return;
        }
      }
      onDone(
        `Se traspasaron ${res.traspasados.length} ${res.traspasados.length === 1 ? "caso" : "casos"}. ${desde} deja de ver a esos pacientes; el estudiante que los recibe empieza a verlos.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo traspasar.");
      setBusy(false);
    }
  }

  // 🔴 Solo alumnos de la MISMA especialidad que los casos elegidos.
  // Cruzarlas dejaría un requisito contando en el plan equivocado, y el
  // servidor lo rebota igual — pero ofrecer una opción que va a fallar es
  // peor que no ofrecerla.
  //
  // Si se eligieron casos de DOS especialidades, no hay ningún alumno que
  // sirva para todos y la lista sale vacía a propósito: la pantalla lo
  // dice abajo, y la salida es traspasarlos en dos tandas.
  const elegidosCasos = casos.filter((c) => elegidos.includes(c.id));
  const programaIds = Array.from(new Set(elegidosCasos.map((c) => c.programId)));
  const programaNombres = Array.from(new Set(elegidosCasos.map((c) => c.programName)));
  const destinosVisibles =
    programaIds.length === 1 ? destinos.filter((d) => d.programId === programaIds[0]) : [];

  return (
    <EduModal
      title="Traspasar casos"
      subtitle="El caso viejo se cierra y se abre uno nuevo con el estudiante que entra. El expediente se queda donde ocurrió."
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
            onClick={traspasar}
            disabled={busy || elegidos.length === 0 || !toStudentId}
          >
            {busy
              ? "Traspasando…"
              : `Traspasar ${elegidos.length} ${elegidos.length === 1 ? "caso" : "casos"}`}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-banner edu-banner--warn">
        <div>
          <p className="edu-banner__title">{desde} pierde el acceso a estos pacientes</p>
          <p className="edu-banner__detail">
            Y el estudiante que los recibe lo gana, en el mismo acto. Sus notas, sus estudios y sus
            calificaciones NO se mueven: quedan donde ocurrieron, con su nombre. Las citas futuras
            sí pasan al estudiante nuevo, para que el paciente no quede a medias.
          </p>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-tr-dest">
          ¿A quién?
        </label>
        <select
          id="edu-tr-dest"
          className="edu-input"
          value={toStudentId}
          onChange={(e) => setToStudentId(e.target.value)}
        >
          <option value="">Elige al estudiante que los recibe</option>
          {destinosVisibles.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.matricula}
            </option>
          ))}
        </select>
        <p className="edu-field__hint">
          {programaIds.length > 1
            ? `Elegiste casos de ${programaIds.length} especialidades (${programaNombres.join(", ")}). Un caso se traspasa dentro de su especialidad: hazlo en dos tandas.`
            : `Tiene que ser de la misma especialidad${programaNombres[0] ? ` (${programaNombres[0]})` : ""} y seguir ACTIVO como estudiante.`}
        </p>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-tr-mot">
          ¿Por qué? (queda escrito en el caso nuevo)
        </label>
        <input
          id="edu-tr-mot"
          className="edu-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Rotación de fin de semestre, egreso, baja…"
          autoComplete="off"
        />
      </div>

      <div className="edu-section__head">
        <h4 className="edu-section__title">Casos abiertos ({casos.length})</h4>
      </div>

      <div className="edu-stack edu-stack--tight">
        {casos.map((c) => {
          const on = elegidos.includes(c.id);
          const fallo = fallidos.find((f) => f.caseId === c.id);
          return (
            <label key={c.id} className={`edu-check ${fallo ? "edu-check--mal" : ""}`}>
              <input
                className="edu-check__input"
                type="checkbox"
                checked={on}
                onChange={() =>
                  setElegidos((prev) =>
                    prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                  )
                }
                disabled={busy}
              />
              <span className="edu-check__body">
                <span className="edu-check__label">
                  {c.patientName} · {c.patientFolio}
                </span>
                <span className="edu-check__hint">
                  {c.programName}
                  {c.procedureName ? ` · ${c.procedureName}` : " · sin procedimiento"}
                  {c.upcomingAppointments > 0
                    ? ` · ${c.upcomingAppointments} ${c.upcomingAppointments === 1 ? "cita futura que se mueve" : "citas futuras que se mueven"}`
                    : " · sin citas futuras"}
                </span>
                {fallo && <span className="edu-check__error">{fallo.error}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </EduModal>
  );
}

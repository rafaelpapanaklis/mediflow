"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_RECETA_MAX_ITEMS,
  EDU_RECETA_VOID_REASON_MIN,
  type EduRecetaCaseOption,
  type EduRecetaRow,
} from "@/lib/edu/recetas-core";
import {
  EDU_PRESCRIPTION_STATUS_DESCRIPTIONS,
  EDU_PRESCRIPTION_STATUS_LABELS,
} from "@/lib/edu/types";

/**
 * LA PESTAÑA RECETAS de la ficha del paciente.
 *
 * MÓVIL PRIMERO, como todo el vertical: tarjetas y no tabla, botones con
 * la etiqueta escrita, el motivo de anular se abre EN LA TARJETA (el
 * teclado del teléfono tapa medio modal).
 *
 * 🔴 LO QUE ESTA PANTALLA NO HACE, y es el diseño: EXPEDIR. El alumno
 * arma la receta y la manda; la firma vive en la bandeja del docente
 * (/instituto/autorizaciones), que es el único sitio donde se decide —
 * con la cédula. Aquí una PENDIENTE se ve esperando, y el botón del PDF
 * solo existe EXPEDIDA o ANULADA. Esconderlo no es el candado (el candado
 * es el 409 del endpoint): es no ofrecer un botón que va a fallar.
 *
 * ⚠️ Editar una PENDIENTE está permitido (solo a quien la propuso): la
 * bandeja marca "la editó después de mandarla" sola, por el hash de la
 * Ola 4, y lo que el docente firma es lo que lee al firmar.
 */
export interface EduRecetasScreenProps {
  patientId: string;
  rows: EduRecetaRow[];
  cases: EduRecetaCaseOption[];
  canPropose: boolean;
  canVoid: boolean;
}

const TAG_POR_ESTADO: Record<string, string> = {
  BORRADOR: "edu-tag--muted",
  PENDIENTE: "edu-tag--info",
  EXPEDIDA: "edu-tag--ok",
  RECHAZADA: "edu-tag--danger",
  ANULADA: "edu-tag--danger",
};

interface ItemForm {
  drug: string;
  presentation: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  notes: string;
}

const ITEM_VACIO: ItemForm = {
  drug: "",
  presentation: "",
  dose: "",
  route: "",
  frequency: "",
  duration: "",
  quantity: "",
  notes: "",
};

interface EditorState {
  /** null = receta nueva. */
  recetaId: string | null;
  caseId: string;
  diagnosis: string;
  indications: string;
  items: ItemForm[];
}

function posologia(it: EduRecetaRow["items"][number]): string {
  return [
    it.presentation,
    it.dose,
    it.route,
    it.frequency,
    it.duration,
    it.quantity ? `surtir ${it.quantity}` : null,
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join(" · ");
}

export function EduRecetasScreen({
  patientId,
  rows,
  cases,
  canPropose,
  canVoid,
}: EduRecetasScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Qué tarjeta tiene abierto el campo del motivo de anulación. */
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  function abrirNueva() {
    setError(null);
    setEditorError(null);
    setEditor({
      recetaId: null,
      // Con un solo caso no se pregunta lo obvio.
      caseId: cases.length === 1 ? cases[0].id : "",
      diagnosis: "",
      indications: "",
      items: [{ ...ITEM_VACIO }],
    });
  }

  function abrirEdicion(row: EduRecetaRow) {
    setError(null);
    setEditorError(null);
    setEditor({
      recetaId: row.id,
      caseId: row.caseId,
      diagnosis: row.diagnosis ?? "",
      indications: row.indications ?? "",
      items:
        row.items.length > 0
          ? row.items.map((it) => ({
              drug: it.drug,
              presentation: it.presentation ?? "",
              dose: it.dose,
              route: it.route ?? "",
              frequency: it.frequency ?? "",
              duration: it.duration ?? "",
              quantity: it.quantity ?? "",
              notes: it.notes ?? "",
            }))
          : [{ ...ITEM_VACIO }],
    });
  }

  function setItem(i: number, patch: Partial<ItemForm>) {
    setEditor((e) =>
      e ? { ...e, items: e.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) } : e,
    );
  }

  async function guardar() {
    if (!editor) return;
    setEditorError(null);
    if (!editor.recetaId && !editor.caseId) {
      setEditorError("Elige el caso: la receta la firmará el docente que responde por él.");
      return;
    }
    const items = editor.items.filter((it) =>
      Object.values(it).some((v) => v.trim().length > 0),
    );
    if (items.length === 0) {
      setEditorError("Agrega al menos un medicamento.");
      return;
    }
    setGuardando(true);
    try {
      const body = {
        caseId: editor.caseId,
        diagnosis: editor.diagnosis,
        indications: editor.indications,
        items,
      };
      if (editor.recetaId) {
        await eduRequest(`/api/instituto/recetas/${editor.recetaId}`, {
          method: "PATCH",
          body,
        });
        setFlash("Receta guardada.");
      } else {
        await eduRequest(`/api/instituto/pacientes/${patientId}/recetas`, {
          method: "POST",
          body,
        });
        setFlash("Receta creada como borrador. Cuando esté lista, mándala a autorización.");
      }
      setEditor(null);
      startNav(() => router.refresh());
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "No se pudo guardar la receta.");
    } finally {
      setGuardando(false);
    }
  }

  async function enviar(row: EduRecetaRow) {
    setError(null);
    setBusyId(row.id);
    try {
      await eduRequest(`/api/instituto/recetas/${row.id}/enviar`, { method: "POST" });
      setFlash(
        "Mandada a autorización. Tu docente la ve en su bandeja; hasta que la firme no se puede imprimir ni entregar.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mandar a autorización.");
    } finally {
      setBusyId(null);
    }
  }

  async function anular(row: EduRecetaRow) {
    const texto = motivo.trim();
    if (texto.length < EDU_RECETA_VOID_REASON_MIN) {
      setError(
        "Escribe por qué se anula. La receta ya salió con una cédula encima: el motivo es la mitad de la constancia.",
      );
      return;
    }
    setError(null);
    setBusyId(row.id);
    try {
      await eduRequest(`/api/instituto/recetas/${row.id}/anular`, {
        method: "POST",
        body: { reason: texto },
      });
      setFlash("Receta anulada. Su PDF sigue saliendo, marcado, con el motivo escrito.");
      setAnulando(null);
      setMotivo("");
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anular la receta.");
    } finally {
      setBusyId(null);
    }
  }

  function tarjeta(row: EduRecetaRow) {
    const ocupada = busyId === row.id;
    const anulandoAqui = anulando === row.id;

    return (
      <article key={row.id} className="edu-nota">
        <div className="edu-nota__head">
          <div>
            <span className="edu-nota__when">{row.createdAtLabel}</span>
            <span className="edu-nota__who">
              {row.programName} · propuso {row.proposedByName}
              {row.proposedByMatricula ? ` (${row.proposedByMatricula})` : ""}
            </span>
          </div>
          <span className={`edu-tag ${TAG_POR_ESTADO[row.status] ?? "edu-tag--muted"}`}>
            {EDU_PRESCRIPTION_STATUS_LABELS[row.status]}
          </span>
        </div>

        {row.diagnosis && <p className="edu-receta__dx">{row.diagnosis}</p>}

        <ol className="edu-receta__meds">
          {row.items.map((it) => (
            <li key={it.id}>
              <strong>{it.drug}</strong>
              {posologia(it) ? ` — ${posologia(it)}` : ""}
              {it.notes ? <span className="edu-receta__mednotas"> · {it.notes}</span> : null}
            </li>
          ))}
        </ol>

        {row.indications && (
          <p className="edu-receta__indicaciones">Indicaciones: {row.indications}</p>
        )}

        {row.status === "PENDIENTE" && (
          <p className="edu-note">
            Esperando la firma del docente en{" "}
            <a className="edu-auth-card__link" href="/instituto/autorizaciones">
              Autorizaciones
            </a>
            . Hasta entonces no se imprime ni se entrega: todavía no la respalda ninguna cédula.
          </p>
        )}

        {row.status === "EXPEDIDA" && row.issuedByName && (
          <p className="edu-receta__firma">
            Expedida por <strong>{row.issuedByName}</strong> · Cédula profesional{" "}
            {row.issuedByCedula} · {row.issuedAtLabel}
          </p>
        )}

        {row.status === "ANULADA" && (
          <p className="edu-receta__anulada">
            Anulada{row.voidedAtLabel ? ` el ${row.voidedAtLabel}` : ""}
            {row.voidedByName ? ` por ${row.voidedByName}` : ""}
            {row.voidReason ? `. Motivo: ${row.voidReason}` : "."}
          </p>
        )}

        {row.lastDecisionNote && (row.status === "BORRADOR" || row.status === "RECHAZADA") && (
          <p className="edu-auth-historial__nota">
            {row.status === "RECHAZADA" ? "El docente la rechazó" : "El docente pidió cambios"}:
            {" "}“{row.lastDecisionNote}”
          </p>
        )}

        <div className="edu-receta__acciones">
          {row.printable && (
            <a
              className="edu-btn edu-btn--primary edu-btn--sm"
              href={`/api/instituto/recetas/${row.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir el PDF
            </a>
          )}
          {row.sendable && row.status === "BORRADOR" && canPropose && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => enviar(row)}
              disabled={ocupada}
            >
              Enviar a autorización
            </button>
          )}
          {row.editable && row.mine && canPropose && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => abrirEdicion(row)}
              disabled={ocupada}
            >
              Editar
            </button>
          )}
          {row.voidable && canVoid && !anulandoAqui && (
            <button
              type="button"
              className="edu-btn edu-btn--danger edu-btn--sm"
              onClick={() => {
                setError(null);
                setMotivo("");
                setAnulando(row.id);
              }}
              disabled={ocupada}
            >
              Anular
            </button>
          )}
        </div>

        {anulandoAqui && (
          <div className="edu-auth-card__motivo">
            <label className="edu-field__label" htmlFor={`anular-${row.id}`}>
              ¿Por qué se anula?
            </label>
            <textarea
              id={`anular-${row.id}`}
              className="edu-input"
              rows={2}
              value={motivo}
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: dosis equivocada; se expide una nueva con la correcta."
            />
            <div className="edu-receta__acciones">
              <button
                type="button"
                className="edu-btn edu-btn--danger edu-btn--sm"
                onClick={() => anular(row)}
                disabled={ocupada}
              >
                Anular con este motivo
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                onClick={() => setAnulando(null)}
                disabled={ocupada}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </article>
    );
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

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Recetas</h2>
          <span className="edu-count">{rows.length}</span>
          {canPropose && cases.length > 0 && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={abrirNueva}
            >
              Nueva receta
            </button>
          )}
        </div>

        {canPropose && cases.length === 0 && (
          <p className="edu-note">
            Para proponer una receta hace falta un caso abierto que te toque: la firmará el docente
            que responde por él.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin recetas que mostrarte</p>
            <p className="edu-empty__detail">
              Aquí el estudiante propone la receta y el docente con cédula la expide: hasta esa firma no
              hay papel que entregar. Las que te toquen de este paciente saldrán aquí con su estado.
            </p>
          </div>
        ) : (
          <div className="edu-stack edu-stack--tight">{rows.map(tarjeta)}</div>
        )}
      </section>

      {editor && (
        <EduModal
          title={editor.recetaId ? "Editar receta" : "Nueva receta"}
          subtitle="El estudiante propone; el docente con cédula la expide desde su bandeja."
          busy={guardando}
          onClose={() => setEditor(null)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setEditor(null)}
                disabled={guardando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={guardar}
                disabled={guardando}
              >
                {editor.recetaId ? "Guardar cambios" : "Guardar borrador"}
              </button>
            </>
          }
        >
          {editorError && (
            <div className="edu-alert" role="alert">
              {editorError}
            </div>
          )}

          {!editor.recetaId && (
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="receta-caso">
                ¿De qué caso?
              </label>
              <select
                id="receta-caso"
                className="edu-input"
                value={editor.caseId}
                onChange={(e) => setEditor({ ...editor, caseId: e.target.value })}
              >
                {cases.length !== 1 && <option value="">Elige…</option>}
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="edu-field__hint">
                La receta se cuelga del caso: es lo que dice qué docente la firma y responde.
              </p>
            </div>
          )}

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="receta-dx">
              Diagnóstico (sale impreso)
            </label>
            <input
              id="receta-dx"
              className="edu-input"
              value={editor.diagnosis}
              onChange={(e) => setEditor({ ...editor, diagnosis: e.target.value })}
              placeholder="Ej.: pulpitis irreversible en 26, posoperatorio de endodoncia"
            />
          </div>

          {editor.items.map((it, i) => (
            <fieldset key={i} className="edu-receta-item">
              <legend className="edu-receta-item__num">Medicamento {i + 1}</legend>
              <div className="edu-receta-itemgrid">
                <div className="edu-field edu-receta-itemgrid--full">
                  <label className="edu-field__label" htmlFor={`it-${i}-drug`}>
                    Medicamento
                  </label>
                  <input
                    id={`it-${i}-drug`}
                    className="edu-input"
                    value={it.drug}
                    onChange={(e) => setItem(i, { drug: e.target.value })}
                    placeholder="Ej.: Amoxicilina"
                  />
                </div>
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`it-${i}-pres`}>
                    Presentación
                  </label>
                  <input
                    id={`it-${i}-pres`}
                    className="edu-input"
                    value={it.presentation}
                    onChange={(e) => setItem(i, { presentation: e.target.value })}
                    placeholder="cápsulas 500 mg"
                  />
                </div>
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`it-${i}-dose`}>
                    Dosis
                  </label>
                  <input
                    id={`it-${i}-dose`}
                    className="edu-input"
                    value={it.dose}
                    onChange={(e) => setItem(i, { dose: e.target.value })}
                    placeholder="1 cápsula"
                  />
                </div>
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`it-${i}-route`}>
                    Vía
                  </label>
                  <input
                    id={`it-${i}-route`}
                    className="edu-input"
                    value={it.route}
                    onChange={(e) => setItem(i, { route: e.target.value })}
                    placeholder="oral"
                  />
                </div>
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`it-${i}-freq`}>
                    Frecuencia
                  </label>
                  <input
                    id={`it-${i}-freq`}
                    className="edu-input"
                    value={it.frequency}
                    onChange={(e) => setItem(i, { frequency: e.target.value })}
                    placeholder="cada 8 horas"
                  />
                </div>
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`it-${i}-dur`}>
                    Duración
                  </label>
                  <input
                    id={`it-${i}-dur`}
                    className="edu-input"
                    value={it.duration}
                    onChange={(e) => setItem(i, { duration: e.target.value })}
                    placeholder="por 7 días"
                  />
                </div>
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`it-${i}-qty`}>
                    Cantidad a surtir
                  </label>
                  <input
                    id={`it-${i}-qty`}
                    className="edu-input"
                    value={it.quantity}
                    onChange={(e) => setItem(i, { quantity: e.target.value })}
                    placeholder="1 caja (21)"
                  />
                </div>
                <div className="edu-field edu-receta-itemgrid--full">
                  <label className="edu-field__label" htmlFor={`it-${i}-notes`}>
                    Indicaciones de este medicamento
                  </label>
                  <input
                    id={`it-${i}-notes`}
                    className="edu-input"
                    value={it.notes}
                    onChange={(e) => setItem(i, { notes: e.target.value })}
                    placeholder="con alimentos; terminar el tratamiento completo"
                  />
                </div>
              </div>
              {editor.items.length > 1 && (
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet edu-btn--sm"
                  onClick={() =>
                    setEditor({ ...editor, items: editor.items.filter((_, j) => j !== i) })
                  }
                  disabled={guardando}
                >
                  Quitar este medicamento
                </button>
              )}
            </fieldset>
          ))}

          {editor.items.length < EDU_RECETA_MAX_ITEMS && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => setEditor({ ...editor, items: [...editor.items, { ...ITEM_VACIO }] })}
              disabled={guardando}
            >
              Agregar otro medicamento
            </button>
          )}

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="receta-ind">
              Indicaciones generales
            </label>
            <textarea
              id="receta-ind"
              className="edu-input"
              rows={2}
              value={editor.indications}
              onChange={(e) => setEditor({ ...editor, indications: e.target.value })}
              placeholder="Ej.: dieta blanda 24 h; acudir a urgencias si hay fiebre o inflamación."
            />
          </div>
        </EduModal>
      )}
    </div>
  );
}

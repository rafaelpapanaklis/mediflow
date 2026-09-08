"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Plus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_REQUIREMENT_MAX_COUNT, type EduRequirementRow } from "@/lib/edu/evaluacion-core";
import { EDU_REQ_VERSION_NOTES_MAX } from "@/lib/edu/requisitos-version-core";

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
  /** El texto libre que ya existe en el catálogo. Se sigue ofreciendo. */
  categories: string[];
  /**
   * H-90 · el catálogo de categorías CON LLAVE, solo las activas.
   *
   * 🔴 CONVIVE con el texto libre y no lo sustituye. Emparejar «Endodoncia»,
   * «endodoncias» y «ENDO» es un juicio humano que ningún `.sql` puede
   * tomar: la pantalla de categorías PROPONE y una persona confirma. Aquí,
   * elegir del catálogo es lo recomendado y escribir texto sigue siendo
   * posible para una escuela que todavía no lo ha ordenado.
   */
  catalogo: { id: string; name: string }[];
  /** H-89 · las generaciones, para versionar por cohorte. */
  cohorts: { id: string; name: string; programId: string; isActive: boolean }[];
}

export function EduRequisitosScreen({
  rows,
  programs,
  procedures,
  categories,
  catalogo,
  cohorts,
}: EduRequisitosScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<EduRequirementRow | null>(null);
  const [versionando, setVersionando] = useState<EduRequirementRow | null>(null);
  const [historial, setHistorial] = useState<EduRequirementRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // ── 🔴 H-90 · LOS FILTROS, POR LLAVE Y NO POR TEXTO ──────────────────
  // Antes de esta ola la única forma de encontrar «los requisitos de
  // Endodoncia» era leer la columna «Qué cuenta» a ojo, y ahí conviven un
  // procedimiento, un texto libre y ahora una categoría del catálogo. El
  // filtro compara por `categoryId` cuando el requisito ya está emparejado
  // y por texto normalizado cuando no — que es exactamente la convivencia
  // que el hallazgo pide mientras la escuela ordena su catálogo.
  const [fProgram, setFProgram] = useState("");
  const [fCategoria, setFCategoria] = useState("");

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  // Los textos libres que todavía no tienen llave, para poder filtrarlos.
  const textosSueltos = Array.from(
    new Set(rows.filter((r) => !r.categoryId && r.category).map((r) => r.category as string)),
  ).sort((a, b) => a.localeCompare(b, "es"));

  const visibles = rows.filter((r) => {
    if (fProgram && r.programId !== fProgram) return false;
    if (!fCategoria) return true;
    if (fCategoria.startsWith("txt:")) {
      // Se compara en minúsculas y sin espacios de sobra, que es lo único
      // que se puede afirmar de dos textos libres sin equivocarse.
      const buscado = fCategoria.slice(4).trim().toLowerCase();
      return (r.category ?? "").trim().toLowerCase() === buscado;
    }
    return r.categoryId === fCategoria;
  });

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
          ? `"${r.name}" deja de exigirse. No se borra nada de lo que los estudiantes ya hicieron: el avance se cuenta, no se guarda.`
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

      <div className="edu-toolbar">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-req-f-prog">
            Especialidad
          </label>
          <select
            id="edu-req-f-prog"
            className="edu-input edu-input--sm"
            value={fProgram}
            onChange={(e) => setFProgram(e.target.value)}
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
          <label className="edu-field__label" htmlFor="edu-req-f-cat">
            Categoría
          </label>
          <select
            id="edu-req-f-cat"
            className="edu-input edu-input--sm"
            value={fCategoria}
            onChange={(e) => setFCategoria(e.target.value)}
          >
            <option value="">Todas</option>
            {catalogo.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {/* Los textos libres que TODAVÍA no tienen llave se siguen
                pudiendo filtrar: esconderlos haría que un requisito sin
                emparejar fuera inencontrable justo mientras se empareja. */}
            {textosSueltos.map((t) => (
              <option key={`txt:${t}`} value={`txt:${t}`}>
                {t} (texto libre)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {visibles.length} de {rows.length}{" "}
          {rows.length === 1 ? "requisito" : "requisitos"}
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

      {visibles.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {rows.length === 0 ? "Todavía no hay requisitos" : "Ningún requisito con ese filtro"}
          </p>
          <p className="edu-empty__detail">
            {rows.length === 0 ? (
              <>
                Sin requisitos, la pantalla de Evaluación no puede decirle a nadie cuánto le falta —
                solo cuántos casos lleva. Captura los de cada especialidad: cuántos de qué, y para
                cuándo.
              </>
            ) : (
              <>
                Hay {rows.length} {rows.length === 1 ? "requisito" : "requisitos"} capturados, pero
                ninguno encaja con lo que estás filtrando. Quita el filtro de arriba para verlos
                todos.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="edu-tablewrap">
          {/* `edu-tablewrap` no es decoración: es lo que hace que esta lista se
             mida a SÍ MISMA (`@container`) en vez de a la ventana, y lo que
             hace que se DESPLACE en vez de recortar si algún día no cabe.
             Sin él, la forma renglón de esta tabla no se estrena nunca:
             desde la Ola B su umbral vive en un `@container`, no en un
             `@media`. */}
          <div className="edu-table edu-table--requisitos">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Requisito</span>
              <span>Especialidad</span>
              <span>Qué cuenta</span>
              <span>Cuántos</span>
              <span>Se exige</span>
              <span />
            </div>

            {visibles.map((r) => (
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
                    {r.procedureName ??
                      r.categoryName ??
                      r.category ??
                      "Cualquier caso de la especialidad"}
                  </span>
                  <span className="edu-cell__sub">
                    {r.onlyCompleted ? "solo casos terminados" : "abiertos o terminados"}
                    {/* 🔴 H-90 · SE DICE CUÁL DE LAS DOS FORMAS SE ESTÁ
                        USANDO. Un requisito por texto libre y uno por llave
                        se ven idénticos en la tabla y NO se comportan igual:
                        renombrar la categoría mueve el avance del primero y
                        no toca el del segundo. Sin esta etiqueta, la
                        dirección no puede saber cuáles le faltan por
                        emparejar. */}
                    {r.categoryId
                      ? " · categoría del catálogo"
                      : r.category
                        ? " · categoría por texto libre"
                        : ""}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Cuántos</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.requiredCount}</span>
                  {/* H-89 · «este número no es el mismo para todas las
                      generaciones» tiene que verse desde la lista, o nadie
                      entiende por qué a un alumno le sale otro. */}
                  {r.versiones > 0 && (
                    <span className="edu-cell__sub">
                      {r.versiones} {r.versiones === 1 ? "versión" : "versiones"} por generación
                    </span>
                  )}
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
                  {/* 🔴 UN SOLO BOTÓN PARA LAS DOS COSAS, y no es por ahorrar
                      sitio: mirar qué ha exigido este requisito y congelar
                      una versión nueva son el MISMO gesto en el orden
                      correcto —se mira antes de cambiar—, así que el
                      historial es la pantalla y versionar es su acción.
                      Además, la pista de acciones de esta tabla mide 158 px
                      (regla 7 de edu-theme.css): cuatro rótulos ahí dentro
                      apilan la fila en cuatro renglones. */}
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setHistorial(r);
                    }}
                    title="Qué ha exigido este requisito a lo largo del tiempo y a qué generación, y desde dónde se congela una versión nueva."
                  >
                    <History size={15} aria-hidden="true" />
                    Versiones
                    {r.versiones > 0 ? ` (${r.versiones})` : ""}
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
        </div>
      )}

      {(creando || editando) && (
        <EditorRequisito
          requisito={editando}
          programs={programs}
          procedures={procedures}
          categories={categories}
          catalogo={catalogo}
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

      {/* El historial se abre primero y el versionado sale DE ÉL: cuando
          los dos están puestos, manda el de encima. */}
      {historial && !versionando && (
        <HistorialRequisito
          requisito={historial}
          onClose={() => setHistorial(null)}
          onVersionar={() => setVersionando(historial)}
        />
      )}

      {versionando && (
        <VersionarRequisito
          requisito={versionando}
          cohorts={cohorts.filter((c) => c.programId === versionando.programId)}
          onClose={() => setVersionando(null)}
          onDone={(mensaje) => {
            setVersionando(null);
            setHistorial(null);
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
  catalogo,
  onClose,
  onDone,
}: {
  requisito: EduRequirementRow | null;
  programs: { id: string; name: string; durationSemesters: number }[];
  procedures: { id: string; name: string; category: string | null }[];
  categories: string[];
  catalogo: { id: string; name: string }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState(requisito?.name ?? "");
  const [programId, setProgramId] = useState(requisito?.programId ?? programs[0]?.id ?? "");
  const [modo, setModo] = useState<"procedimiento" | "categoria" | "cualquiera">(
    requisito?.procedureId
      ? "procedimiento"
      : requisito?.categoryId || requisito?.category
        ? "categoria"
        : "cualquiera",
  );
  const [procedureId, setProcedureId] = useState(requisito?.procedureId ?? "");
  const [category, setCategory] = useState(requisito?.category ?? "");
  // H-90 · la categoría del catálogo. `""` = ninguna, y entonces manda el
  // texto libre de abajo (que es como funcionaba antes de esta ola).
  const [categoryId, setCategoryId] = useState(requisito?.categoryId ?? "");
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
        // 🔴 H-90 · CUANDO SE ELIGE DEL CATÁLOGO, EL TEXTO LIBRE VIAJA EN
        // NULL. Dejar los dos puestos haría que el requisito se viera
        // emparejado y siguiera contando por texto en cuanto alguien
        // desconectara la llave: dos fuentes para el mismo número.
        category: modo === "categoria" && !categoryId ? category.trim() || null : null,
        categoryId: modo === "categoria" ? categoryId || null : null,
        requiredCount: requiredCount.trim(),
        semesterFrom: semesterFrom.trim() || null,
        semesterTo: semesterTo.trim() || null,
        onlyCompleted,
        notes: notes.trim() || null,
      };

      if (requisito) {
        // 🔴 OLA C · H-98 — EL PATCH NO MANDA `programId`.
        //
        // `updateEduRequirement` no lo lee NUNCA. Hoy es inocuo porque el
        // `<select>` está deshabilitado al editar; el día que alguien lo
        // habilite para "arreglar" un requisito de la especialidad
        // equivocada, la pantalla diría «Requisito guardado» y no habría
        // cambiado nada. Mandar un campo que el servidor ignora es
        // exactamente cómo nace ese fallo mudo: se deja de mandar.
        const { programId: _noSeCambia, ...cambios } = body;
        await eduRequest(`/api/instituto/requisitos/${requisito.id}`, {
          method: "PATCH",
          body: cambios,
        });
        onDone(`Requisito "${body.name}" guardado. El avance de cada estudiante se recalcula solo.`);
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
      subtitle="Cuántos de qué necesita un estudiante para cerrar. El avance se cuenta solo."
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
        El rango marca CUÁNDO se le exige al estudiante: antes del semestre inicial el semáforo no se
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
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-req-catid">
              Categoría del catálogo
            </label>
            <select
              id="edu-req-catid"
              className="edu-input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={catalogo.length === 0}
            >
              <option value="">— por texto libre (como antes) —</option>
              {catalogo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="edu-field__hint">
              {catalogo.length === 0 ? (
                <>
                  Todavía no hay catálogo de categorías. Se captura en Procedimientos → Categorías; con
                  él, renombrar una categoría deja de poner el avance a cero.
                </>
              ) : (
                <>
                  Elegir del catálogo ata el requisito a una llave: renombrar la categoría después ya
                  no mueve ni un número del avance. Es lo recomendado.
                </>
              )}
            </p>
          </div>

          {!categoryId && (
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-req-cat">
                Categoría (texto libre)
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
                Se compara con el texto de la categoría del procedimiento, sin distinguir mayúsculas
                ni acentos.{" "}
                <strong>
                  Renombrar la categoría en el catálogo pone este avance a cero, en silencio
                </strong>{" "}
                — por eso existe el desplegable de arriba.
              </p>
            </div>
          )}
        </>
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

// ═══════════════════════════════════════════════════════════════════════
// 🔴 H-89 · VERSIONAR UN REQUISITO
//
// «Subir el mínimo de un requisito a mitad de generación reescribe el
// pasado de todo el mundo, sin versión y sin rastro. De 8 a 12 en marzo y
// TODA la escuela —incluida la que se gradúa en junio— pasa de "Cumplido 8
// de 8" a "Te faltan 4 de 12". El alumno lo ve esa tarde, sin explicación y
// sin fecha.»
//
// Lo que esta ventana hace es CONGELAR lo que el requisito exige, con una
// fecha de vigencia y, si hace falta, una generación. A partir de ahí cada
// alumno se mide contra la versión de SU generación (eduRequisitoEfectivo).
//
// 🔴 NO BLOQUEA UN CAMBIO QUE DUELE, LO AVISA. Subir el mínimo es una
// decisión legítima de la escuela; lo que no es legítimo es que ocurra sin
// que nadie lo sepa. El servidor devuelve `duele: true` y aquí se pone
// delante ANTES de guardar.
// ═══════════════════════════════════════════════════════════════════════
function VersionarRequisito({
  requisito,
  cohorts,
  onClose,
  onDone,
}: {
  requisito: EduRequirementRow;
  cohorts: { id: string; name: string; isActive: boolean }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [cohortId, setCohortId] = useState("");
  const [requiredCount, setRequiredCount] = useState(String(requisito.requiredCount));
  const [onlyCompleted, setOnlyCompleted] = useState(requisito.onlyCompleted);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nuevo = Number.parseInt(requiredCount, 10);
  // La MISMA regla que `eduRequisitoCambioDuele` del servidor, escrita aquí
  // solo para AVISAR antes de mandar. El servidor la vuelve a evaluar y su
  // respuesta es la que manda: esto es un rótulo, no una validación.
  const duele =
    (Number.isFinite(nuevo) && nuevo > requisito.requiredCount) ||
    (!requisito.onlyCompleted && onlyCompleted);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const r = await eduRequest<{ version: number; duele: boolean }>(
        `/api/instituto/plan-estudios/${requisito.id}/versiones`,
        {
          method: "POST",
          body: {
            cohortId: cohortId || null,
            requiredCount: requiredCount.trim(),
            onlyCompleted,
            effectiveFrom: effectiveFrom || undefined,
            notes: notes.trim() || null,
          },
        },
      );
      onDone(
        `Versión ${r.version} de "${requisito.name}" congelada${
          cohortId ? " para esa generación" : ""
        }. El avance de cada estudiante se mide ahora contra la versión de la suya.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo versionar el requisito.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Versionar «${requisito.name}»`}
      subtitle="Congela lo que se exige, con su fecha y su generación. Nadie pierde un «cumplido» que ya tenía."
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
            disabled={busy || !requiredCount.trim()}
          >
            {busy ? "Guardando…" : "Congelar esta versión"}
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
        <label className="edu-field__label" htmlFor="edu-reqv-cohort">
          A qué generación aplica
        </label>
        <select
          id="edu-reqv-cohort"
          className="edu-input"
          value={cohortId}
          onChange={(e) => setCohortId(e.target.value)}
        >
          <option value="">A todas las que no tengan una propia (regla general)</option>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isActive ? "" : " (cerrada)"}
            </option>
          ))}
        </select>
        <p className="edu-field__hint">
          Una versión CON generación gana sobre la general para los alumnos de esa generación. Así se
          sube el mínimo para los que entran ahora sin tocar a los que se gradúan en junio.
        </p>
      </div>

      <div className="edu-formgrid">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-reqv-count">
            Cuántos exige esta versión
          </label>
          <input
            id="edu-reqv-count"
            className="edu-input"
            inputMode="numeric"
            value={requiredCount}
            onChange={(e) => setRequiredCount(e.target.value)}
            autoComplete="off"
          />
          <p className="edu-field__hint">
            Hoy exige {requisito.requiredCount}. Entre 0 y {EDU_REQUIREMENT_MAX_COUNT}.
          </p>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-reqv-desde">
            Rige desde
          </label>
          <input
            id="edu-reqv-desde"
            className="edu-input"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
          <p className="edu-field__hint">En blanco = desde ahora mismo.</p>
        </div>
      </div>

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
            Se congela con la versión, igual que el mínimo: es la otra mitad de «cuánto se exige».
          </span>
        </span>
      </label>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-reqv-notes">
          Por qué cambia (opcional)
        </label>
        <input
          id="edu-reqv-notes"
          className="edu-input"
          value={notes}
          maxLength={EDU_REQ_VERSION_NOTES_MAX}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Acuerdo del consejo académico del 3 de marzo"
          autoComplete="off"
        />
        <p className="edu-field__hint">
          Es lo que se lee en el historial dentro de un año, cuando alguien pregunte por qué su
          generación se gradúa con doce.
        </p>
      </div>

      {duele && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Este cambio le quita avance a alguien</p>
            <p className="edu-banner__detail">
              Estás subiendo lo que se exige. Quien ya cumplía va a ver que le falta — y ésa es
              exactamente la tarde que este historial existe para explicar. Si no quieres tocar a las
              generaciones en curso, elige arriba solo la generación nueva.
            </p>
          </div>
        </div>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL HISTORIAL de un requisito (H-89)
// ═══════════════════════════════════════════════════════════════════════

interface VersionRow {
  id: string;
  version: number;
  cohortId: string | null;
  cohortName: string | null;
  requiredCount: number;
  semesterFrom: number | null;
  semesterTo: number | null;
  onlyCompleted: boolean;
  notes: string | null;
  effectiveFrom: string;
  createdByName: string;
}

function HistorialRequisito({
  requisito,
  onClose,
  onVersionar,
}: {
  requisito: EduRequirementRow;
  onClose: () => void;
  onVersionar: () => void;
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [vigente, setVigente] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    eduRequest<{ rows: VersionRow[]; vigenteGeneral: number | null }>(
      `/api/instituto/plan-estudios/${requisito.id}/versiones`,
    )
      .then((r) => {
        if (!vivo) return;
        setRows(r.rows);
        setVigente(r.vigenteGeneral);
      })
      .catch((err) => {
        if (!vivo) return;
        setError(err instanceof Error ? err.message : "No se pudo leer el historial.");
      });
    // La bandera evita escribir estado sobre un modal ya cerrado: sin ella,
    // cerrar mientras la petición está en vuelo avisa en consola y, con
    // StrictMode, pinta dos veces.
    return () => {
      vivo = false;
    };
  }, [requisito.id]);

  return (
    <EduModal
      title={`Versiones de «${requisito.name}»`}
      subtitle="Qué ha exigido este requisito, desde cuándo y a qué generación."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={onVersionar}>
            Congelar una versión
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {rows === null && !error && <p className="edu-note">Cargando…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Nunca se ha versionado</p>
          <p className="edu-empty__detail">
            Todo el mundo se mide contra lo que dice el requisito hoy: {requisito.requiredCount}{" "}
            {requisito.requiredCount === 1 ? "caso" : "casos"}. Eso significa que si mañana subes ese
            número, la escuela entera lo verá esa tarde. Usa «Versionar» ANTES de subirlo y las
            generaciones en curso se quedan con lo que se les prometió.
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="edu-tablewrap">
          <div className="edu-table edu-table--reqversiones">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Versión</span>
              <span>Generación</span>
              <span>Mínimo</span>
              <span>Qué cuenta</span>
              <span>Rige desde</span>
              <span>Quién</span>
            </div>
            {rows.map((v) => (
              <div key={v.id} className="edu-row">
                <div className="edu-cell">
                  <span className="edu-cell__label">Versión</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    v{v.version}
                    {v.version === vigente ? " · vigente" : ""}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Generación</span>
                  <span className="edu-cell__value">
                    {v.cohortName ?? "Todas (regla general)"}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Mínimo</span>
                  <span className="edu-cell__value edu-cell__value--strong">{v.requiredCount}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Qué cuenta</span>
                  <span className="edu-cell__value">
                    {v.onlyCompleted ? "Solo terminados" : "Abiertos o terminados"}
                  </span>
                  {(v.semesterFrom || v.semesterTo) && (
                    <span className="edu-cell__sub">
                      De {v.semesterFrom ?? 1}º a {v.semesterTo ? `${v.semesterTo}º` : "fin del plan"}
                    </span>
                  )}
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Rige desde</span>
                  {/* La fecha se recorta del ISO a propósito: `effectiveFrom`
                      se captura como DÍA y pintarla con la zona del
                      navegador la movería un día para quien esté en otro
                      huso. */}
                  <span className="edu-cell__value">{v.effectiveFrom.slice(0, 10)}</span>
                  {v.notes && <span className="edu-cell__sub">{v.notes}</span>}
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Quién</span>
                  <span className="edu-cell__value">{v.createdByName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </EduModal>
  );
}

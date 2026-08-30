"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCopy, Loader2, Sparkles } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_ANALISIS_AVISO,
  eduAnalisisComoTexto,
  eduConfianzaLabel,
  eduIaCostoLabel,
  eduSeveridadLabel,
  eduSeveridadTag,
  type EduAnalisisRow,
  type EduIaEstado,
} from "@/lib/edu/ia-core";
import type { EduStudyRow } from "@/lib/edu/estudios-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * APOYO DIAGNÓSTICO CON IA — el panel que vive DENTRO del visor.
 *
 * 🔴 LAS DOS REGLAS QUE ESTA PANTALLA EXISTE PARA CUMPLIR:
 *
 *   1. LO DICE. El aviso de "esto es apoyo, no diagnóstico" va arriba del
 *      todo, no se puede cerrar y no está en letra chica. Un alumno en
 *      formación es exactamente el lector al que un modelo seguro de sí
 *      mismo puede convencer.
 *
 *   2. NO SE ESCRIBE SOLO EN LA NOTA. No hay ningún botón de "pasar a la
 *      nota" y no lo hay a propósito. Lo único que se ofrece es COPIAR: si
 *      el alumno quiere usar algo, lo pega, lo lee, lo corrige y lo firma
 *      con su nombre. Es el mismo criterio del aiAssist del dental, que no
 *      toca el S/O/A/P.
 *
 * ⚠️ Las lecturas se ACUMULAN: la pantalla enseña la última y deja abrir
 * las anteriores. En una escuela, el docente tiene que poder ver lo que su
 * alumno vio cuando decidió, no la versión que lo reemplazó.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduAnalisisIaProps {
  estudio: EduStudyRow;
  /** Estado de la IA, resuelto en el servidor. */
  estado: EduIaEstado;
  /** ¿Esta sesión tiene `estudios.analyze`? El endpoint lo vuelve a exigir. */
  canAnalyze: boolean;
}

export function EduAnalisisIa({ estudio, estado, canAnalyze }: EduAnalisisIaProps) {
  const [rows, setRows] = useState<EduAnalisisRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verTodo, setVerTodo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const data = await eduRequest<{ rows: EduAnalisisRow[] }>(
        `/api/instituto/estudios/${estudio.id}/analisis`,
      );
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron leer los análisis.");
    } finally {
      setCargando(false);
    }
  }, [estudio.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function analizar() {
    setError(null);
    setAviso(null);
    setTrabajando(true);
    try {
      const data = await eduRequest<{ row: EduAnalisisRow; reutilizado: boolean }>(
        `/api/instituto/estudios/${estudio.id}/analisis`,
        { method: "POST" },
      );
      if (data && data.row) {
        setRows((prev) =>
          // El freno de doble toque devuelve una fila que YA está en la
          // lista: agregarla otra vez pintaría dos lecturas idénticas.
          prev.some((r) => r.id === data.row.id) ? prev : [data.row, ...prev],
        );
        if (data.reutilizado) {
          setAviso("Ya había una lectura de hace un momento: se reusó en vez de pedir otra.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar la imagen.");
    } finally {
      setTrabajando(false);
    }
  }

  async function copiar(a: EduAnalisisRow) {
    const texto = eduAnalisisComoTexto(a);
    try {
      await navigator.clipboard.writeText(texto);
      setAviso("Copiado. Pégalo en tu nota, léelo y corrígelo antes de firmarla.");
    } catch {
      setError("Este navegador no dejó copiar. Selecciona el texto a mano.");
    }
  }

  // El botón solo aparece si el estudio es una imagen. Ofrecerlo sobre un
  // .zip de cortes DICOM sería ofrecer un botón que siempre contesta que no.
  const analizable = estudio.isImage;
  const visibles = verTodo ? rows : rows.slice(0, 1);

  return (
    <section className="edu-ia">
      <div className="edu-ia__head">
        <span className="edu-ia__title">
          <Sparkles size={15} aria-hidden />
          Apoyo de IA
        </span>
        {canAnalyze && analizable && estado.disponible && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={analizar}
            disabled={trabajando}
          >
            {trabajando ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {trabajando ? "Analizando…" : rows.length > 0 ? "Analizar otra vez" : "Analizar"}
          </button>
        )}
      </div>

      {/* 🔴 EL AVISO VA SIEMPRE, haya o no haya análisis, y no se cierra. */}
      <p className="edu-ia__aviso">
        <AlertTriangle size={14} aria-hidden />
        <span>{EDU_ANALISIS_AVISO}</span>
      </p>

      {!estado.disponible && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">{estado.titulo}</p>
            <p className="edu-banner__detail">{estado.detalle}</p>
          </div>
        </div>
      )}

      {estado.disponible && !analizable && (
        <p className="edu-note">
          Solo se pueden analizar imágenes (jpg, png o webp). Una tomografía en .zip, un corte DICOM
          suelto o un PDF no se le pueden enseñar al modelo: exporta la proyección que quieres que
          mire y súbela como imagen.
        </p>
      )}

      {estado.disponible && analizable && !canAnalyze && (
        <p className="edu-note">
          Tu cuenta no tiene el permiso <code>estudios.analyze</code>. Puedes leer los análisis que
          ya existen, pero no pedir uno nuevo.
        </p>
      )}

      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}
      {aviso && (
        <div className="edu-alert edu-alert--ok" role="status">
          {aviso}
        </div>
      )}

      {cargando && <p className="edu-note">Buscando lecturas anteriores…</p>}

      {!cargando && rows.length === 0 && (
        <p className="edu-note">
          Esta imagen todavía no tiene ninguna lectura de IA.
        </p>
      )}

      {visibles.map((a, i) => (
        <article key={a.id} className="edu-ia__card">
          <div className="edu-ia__meta">
            <span className={`edu-tag ${eduSeveridadTag(a.severity)}`}>
              {eduSeveridadLabel(a.severity)}
            </span>
            <span className="edu-estudio__meta">
              {a.createdLabel} · lo pidió {a.requestedByName}
              {i === 0 && rows.length > 1 ? " · la más reciente" : ""}
            </span>
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => copiar(a)}
              title="Copiar el texto para pegarlo en tu nota"
            >
              <ClipboardCopy size={14} />
              Copiar
            </button>
          </div>

          {a.summary && <p className="edu-ia__resumen">{a.summary}</p>}

          {a.hallazgos.length > 0 && (
            <ul className="edu-ia__hallazgos">
              {a.hallazgos.map((h) => (
                <li key={h.id}>
                  <span className="edu-ia__hallazgo-top">
                    <strong>{h.title}</strong>
                    {h.tooth && <span className="edu-ia__diente">pieza {h.tooth}</span>}
                    <span className={`edu-tag ${eduSeveridadTag(h.severity)}`}>
                      {eduSeveridadLabel(h.severity)}
                    </span>
                    <span className="edu-ia__conf">
                      confianza {eduConfianzaLabel(h.confidence)}
                    </span>
                  </span>
                  {h.description && <span className="edu-ia__desc">{h.description}</span>}
                  {h.confidenceRationale && (
                    <span className="edu-ia__desc edu-ia__desc--razon">
                      Por qué esa confianza: {h.confidenceRationale}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {a.recomendaciones.length > 0 && (
            <div>
              <span className="edu-kv__k">Recomendaciones</span>
              <ul className="edu-ia__recos">
                {a.recomendaciones.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* El costo se pinta a propósito: hoy no se le cobra a nadie
              —el instituto no tiene cartera de IA— y precisamente por eso
              tiene que verse lo que se está gastando. */}
          <span className="edu-estudio__meta">
            {a.modelUsed} · {a.tokensUsed.toLocaleString("es-MX")} tokens ·{" "}
            {eduIaCostoLabel(a.costUsdMicros)}
          </span>
        </article>
      ))}

      {rows.length > 1 && (
        <button
          type="button"
          className="edu-btn edu-btn--quiet edu-btn--sm"
          onClick={() => setVerTodo((v) => !v)}
        >
          {verTodo
            ? "Ver solo la última"
            : `Ver las ${rows.length - 1} lecturas anteriores`}
        </button>
      )}
    </section>
  );
}

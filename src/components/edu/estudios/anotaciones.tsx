"use client";

import { useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_STUDY_MARK_LABEL_MAX,
  EDU_STUDY_MAX_MARKS,
  type EduStudyMark,
} from "@/lib/edu/estudios-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LAS ANOTACIONES SOBRE LA IMAGEN — marcas x/y con etiqueta.
 *
 * La columna `EduStudy.annotations` existe desde la Ola B y no la leía
 * nadie. Es lo que el dental sí tiene en `PatientFile` y aquí faltaba
 * (fila 18 del informe ws2-t1): `notes` es el texto que se lee debajo;
 * esto es lo que se DIBUJA encima.
 *
 * 🔴 LAS COORDENADAS SON RELATIVAS (0 a 1), NO PÍXELES. La misma
 * panorámica se pinta a 320 px en un teléfono y a 900 en un monitor: una
 * marca en píxeles apuntaría a otro diente en cada pantalla. Por eso el
 * overlay se monta sobre una caja que mide EXACTAMENTE lo que la imagen
 * (`display: block` + la caja se encoge a su contenido) y no sobre el
 * marco, que puede tener franjas vacías arriba y abajo por el
 * `object-fit: contain`.
 *
 * ⚠️ SIN `estudios.upload` ES SOLO LECTURA: las marcas se ven, no se
 * ponen ni se quitan, y no hay botón de guardar que falle con un 403.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduEstudioAnotacionesProps {
  estudioId: string;
  url: string;
  alt: string;
  marcas: EduStudyMark[];
  /** `estudios.upload`. Sin él, solo se miran. */
  canUpload: boolean;
  /** Clase extra del marco (el zoom del visor). */
  zoom?: boolean;
}

export function EduEstudioAnotaciones({
  estudioId,
  url,
  alt,
  marcas,
  canUpload,
  zoom,
}: EduEstudioAnotacionesProps) {
  const [lista, setLista] = useState<EduStudyMark[]>(marcas);
  const [guardado, setGuardado] = useState<EduStudyMark[]>(marcas);
  const [marcando, setMarcando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const cajaRef = useRef<HTMLDivElement | null>(null);

  const cambio = JSON.stringify(lista) !== JSON.stringify(guardado);
  const lleno = lista.length >= EDU_STUDY_MAX_MARKS;

  /**
   * Un clic sobre la imagen pone una marca donde se tocó.
   *
   * Se usa el rectángulo de la CAJA de la imagen y no el del marco: la
   * caja mide lo que la imagen pintada, así que el porcentaje que sale de
   * aquí es el mismo que después la coloca.
   */
  function poner(clientX: number, clientY: number) {
    const rect = cajaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setOk(false);
    setLista((prev) =>
      prev.length >= EDU_STUDY_MAX_MARKS ? prev : [...prev, { x, y, label: "Sin etiqueta" }],
    );
  }

  async function guardar() {
    setError(null);
    setOk(false);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/estudios/${estudioId}`, {
        method: "PATCH",
        // Se manda la LISTA ENTERA, no un delta: es lo único que permite
        // borrar una marca. El servidor la sanea y guarda null si va vacía.
        body: { annotations: lista },
      });
      setGuardado(lista);
      setOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las marcas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edu-estudios-anot">
      <div className={`edu-visor__marco ${zoom ? "edu-visor__marco--zoom" : ""}`}>
        <div
          ref={cajaRef}
          className={`edu-estudios-anot__caja ${zoom ? "edu-estudios-anot__caja--zoom" : ""}`}
          style={{ cursor: marcando ? "crosshair" : undefined }}
          onClick={(e) => {
            if (!marcando || !canUpload || lleno) return;
            poner(e.clientX, e.clientY);
          }}
        >
          {/* <img> y no next/image a propósito: la URL es FIRMADA y caduca,
              así que el optimizador de Next la cachearía en una ruta que
              después devuelve 403. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} className="edu-estudios-anot__img" />

          {lista.map((m, i) => (
            <span
              key={`${i}-${m.x}-${m.y}`}
              className="edu-estudios-anot__marca"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              title={m.label}
            >
              <span className="edu-estudios-anot__punto" aria-hidden />
              <span className="edu-estudios-anot__texto">{m.label}</span>
            </span>
          ))}
        </div>
      </div>

      {canUpload ? (
        <>
          <div className="edu-actions">
            <button
              type="button"
              className={`edu-btn edu-btn--sm ${marcando ? "edu-btn--primary" : "edu-btn--ghost"}`}
              onClick={() => setMarcando((v) => !v)}
              disabled={busy || lleno}
              aria-pressed={marcando}
            >
              <MapPin size={15} />
              {marcando ? "Toca la imagen para marcar" : "Poner una marca"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={guardar}
              disabled={busy || !cambio}
            >
              {busy ? "Guardando…" : "Guardar las marcas"}
            </button>
            {ok && !cambio && <span className="edu-field__hint">Guardadas.</span>}
          </div>

          {lleno && (
            <p className="edu-field__hint">
              Son ya {EDU_STUDY_MAX_MARKS} marcas, el máximo. No es un límite técnico: más
              etiquetas encima de una placa no se leen, y para el detalle en palabras están las
              notas de abajo.
            </p>
          )}

          {error && (
            <div className="edu-alert" role="alert">
              {error}
            </div>
          )}

          {lista.length > 0 && (
            <ul className="edu-estudios-anot__lista">
              {lista.map((m, i) => (
                <li key={`ed-${i}`} className="edu-estudios-anot__fila">
                  <span className="edu-estudios-anot__num" aria-hidden>
                    {i + 1}
                  </span>
                  <input
                    className="edu-input"
                    value={m.label}
                    maxLength={EDU_STUDY_MARK_LABEL_MAX}
                    disabled={busy}
                    aria-label={`Etiqueta de la marca ${i + 1}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOk(false);
                      setLista((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, label: v } : x)),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    aria-label={`Quitar la marca ${i + 1}`}
                    disabled={busy}
                    onClick={() => {
                      setOk(false);
                      setLista((prev) => prev.filter((_, j) => j !== i));
                    }}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="edu-field__hint">
            Una marca sin etiqueta no se guarda: el servidor la descarta. Escribe qué señala («36,
            fractura vestibular») antes de guardar.
          </p>
        </>
      ) : (
        lista.length > 0 && (
          <p className="edu-field__hint">
            {lista.length === 1 ? "Hay 1 marca" : `Hay ${lista.length} marcas`} sobre la imagen.
            Para ponerlas o quitarlas hace falta el permiso de subir estudios.
          </p>
        )
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Download, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { EduVisorShell } from "@/components/edu/estudios/visor-shell";
import { EDU_STUDY_KIND_LABELS } from "@/lib/edu/types";
import type { EduStudyRow } from "@/lib/edu/estudios-core";
import type { EduIaEstado } from "@/lib/edu/ia-core";
import type { Dictionary } from "@/i18n/t";
import { EduAnalisisIa } from "@/components/edu/expediente/analisis-ia";
import { EduModelo3DViewer } from "@/components/edu/estudios/modelo-3d-viewer";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL VISOR DEL VERTICAL — con 3D de verdad, y en la VENTANA entera.
 *
 * Qué abre cada cosa:
 *   · imágenes (jpg/png/webp)   → aquí dentro, con zoom (Ola 3)
 *   · PDF                       → aquí dentro (Ola 3)
 *   · MALLAS (.stl .ply .obj)   → el visor de modelos del DENTAL
 *     (src/components/patient-3d/Model3DViewer.tsx), IMPORTADO tal cual a
 *     través de un adaptador propio (src/components/edu/estudios/
 *     modelo-3d-viewer.tsx) que le monta el i18n que necesita y NO le pasa
 *     patientId/fileId — así su única escritura (un PATCH a las tablas del
 *     dental) queda inalcanzable. Cero copias.
 *   · CBCT (.zip de cortes, .dcm)→ un contenedor PROPIO
 *     (src/components/edu/estudios/cbct-viewer.tsx) que importa las piezas
 *     puras del visor del dental (MprPane, Dicom3DVolume, PanoramicPane con
 *     su auto-detección de la arcada, el worker de decodificación y toda la
 *     matemática de geometría). El contenedor del dental (DicomSetViewer)
 *     NO se importa: sus fetch internos apuntan a /api/patients/** y con
 *     ids del instituto contestan 401/404 — un adaptador no puede
 *     redirigir un fetch escrito dentro.
 *
 * 🔴 DÓNDE SE ABRE, Y POR QUÉ NO SIEMPRE EN EL MISMO SITIO. Una imagen o un
 * PDF caben de sobra en la hoja del vertical (`EduModal`) y ahí siguen. Un
 * CBCT o una malla NO: son cinco vistas que quieren el monitor completo, y
 * una hoja de ancho fijo desperdicia media pantalla de 27". Por eso esos
 * dos abren en `EduVisorShell`, la hoja del visor: ocupa el alto y el ancho
 * REALES de la ventana (100dvh), trae pantalla completa del sistema y
 * conserva las mismas reglas de siempre —Escape, foco que vuelve, fondo que
 * no se desplaza—. `EduModal` no se tocó: lo usan ~20 pantallas del
 * vertical y ensancharlo una tercera vez por el visor habría sido cambiarle
 * la forma a todas.
 *
 * Los dos visores 3D entran por dynamic(ssr:false): three.js, jszip y el
 * worker pesan, y solo los paga quien abre un estudio 3D.
 * ═══════════════════════════════════════════════════════════════════════
 */
const EduCbctViewer = dynamic(
  () => import("@/components/edu/estudios/cbct-viewer").then((m) => m.EduCbctViewer),
  {
    ssr: false,
    loading: () => (
      <div className="edu-visor3d-cargando" role="status">
        <Loader2 className="edu-girando" size={18} /> Preparando el visor CBCT…
      </div>
    ),
  },
);

export function EduEstudioViewer({
  estudio,
  onClose,
  iaAnalisis,
  canAnalyze,
  dict3d,
}: {
  estudio: EduStudyRow;
  onClose: () => void;
  /** Ola 3B: si el apoyo de IA está disponible, y si no, por qué. */
  iaAnalisis: EduIaEstado;
  canAnalyze: boolean;
  /** El trozo de diccionario que necesita el visor de mallas. */
  dict3d: Dictionary;
}) {
  const [zoom, setZoom] = useState(false);

  const sinUrl = !estudio.url;
  const esMalla = estudio.kind === "MODELO_3D";
  const esCbct = estudio.kind === "TOMOGRAFIA";
  const es3d = (esMalla || esCbct) && !sinUrl;

  const subtitulo = `${EDU_STUDY_KIND_LABELS[estudio.kind]} · ${estudio.sizeLabel} · subió ${estudio.uploadedByName}`;

  const pie = (
    <>
      <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose}>
        Cerrar
      </button>
      {estudio.isImage && !sinUrl && (
        <button
          type="button"
          className="edu-btn edu-btn--ghost"
          onClick={() => setZoom((z) => !z)}
        >
          {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
          {zoom ? "Ajustar" : "Ampliar"}
        </button>
      )}
      {!sinUrl && (
        <a
          className="edu-btn edu-btn--primary"
          href={estudio.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={16} />
          Descargar
        </a>
      )}
    </>
  );

  /* Notas, apoyo de IA y ficha del estudio. Van igual en las dos hojas: en
     la del visor quedan bajo la rejilla, a un desplazamiento — la rejilla
     se dimensiona para ocupar la primera pantalla, no para tapar esto. */
  const extras = (
    <>
      {estudio.notes && (
        <div>
          <span className="edu-kv__k">Notas</span>
          <p className="edu-estudio__notes">{estudio.notes}</p>
        </div>
      )}

      {/* Ola 3B · el apoyo de IA vive DENTRO del visor y no en la
          galería: la lectura solo tiene sentido con la imagen delante.
          El panel se pinta siempre —también cuando la IA está apagada—
          porque su primer trabajo es explicar por qué lo está. */}
      <EduAnalisisIa estudio={estudio} estado={iaAnalisis} canAnalyze={canAnalyze} />

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Subido</span>
          <span className="edu-kv__v">{estudio.createdLabel}</span>
        </div>
        <div>
          <span className="edu-kv__k">Caso</span>
          <span className="edu-kv__v">{estudio.caseProgramName ?? "Sin caso"}</span>
        </div>
      </div>
    </>
  );

  if (es3d) {
    return (
      <EduVisorShell
        title={estudio.name}
        subtitle={subtitulo}
        onClose={onClose}
        footer={pie}
      >
        {esMalla ? (
          <EduModelo3DViewer url={estudio.url} name={estudio.name} dict3d={dict3d} />
        ) : (
          <EduCbctViewer
            url={estudio.url}
            name={estudio.name}
            sizeBytes={estudio.sizeBytes}
            cacheKey={estudio.id}
          />
        )}
        {extras}
      </EduVisorShell>
    );
  }

  return (
    <EduModal title={estudio.name} subtitle={subtitulo} onClose={onClose} footer={pie}>
      <div className="edu-visor">
        {sinUrl ? (
          <div className="edu-alert" role="alert">
            No se pudo generar el enlace del archivo. Puede que el almacenamiento no esté
            configurado en este entorno, o que el objeto ya no exista en el bucket.
          </div>
        ) : estudio.isImage ? (
          <div className={`edu-visor__marco ${zoom ? "edu-visor__marco--zoom" : ""}`}>
            {/* <img> y no next/image a propósito: la URL es FIRMADA y
                caduca, así que el optimizador de Next la cachearía en una
                ruta que después devuelve 403. Además el dominio de Supabase
                tendría que ir en next.config.js, que es un archivo del
                dental y esta ola no lo toca. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={estudio.url} alt={estudio.name} />
          </div>
        ) : estudio.isPdf ? (
          <object className="edu-visor__pdf" data={estudio.url} type="application/pdf">
            <p className="edu-note">
              Tu navegador no puede abrir el PDF aquí dentro. Descárgalo con el botón de abajo.
            </p>
          </object>
        ) : (
          <div className="edu-banner">
            <div>
              <p className="edu-banner__title">Este archivo se descarga</p>
              <p className="edu-banner__detail">
                No es una imagen, un PDF, una tomografía ni una malla 3D, así que no hay
                visor que lo pinte aquí dentro. El archivo está íntegro y a un clic.
              </p>
            </div>
          </div>
        )}

        {extras}
      </div>
    </EduModal>
  );
}

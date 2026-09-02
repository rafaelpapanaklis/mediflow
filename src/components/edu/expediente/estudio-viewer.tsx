"use client";

import { useState } from "react";
import { Download, ZoomIn, ZoomOut } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { EduVisorModal } from "@/components/edu/estudios/visor-modal";
import { eduVisorPorExtension } from "@/components/edu/estudios/visor-tipo";
import type { EduStudyRow } from "@/lib/edu/estudios-core";
import type { EduIaEstado } from "@/lib/edu/ia-core";
import type { Dictionary } from "@/i18n/t";
import { EduAnalisisIa } from "@/components/edu/expediente/analisis-ia";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL VISOR DEL ESTUDIO — quién abre qué.
 *
 *   · imágenes (jpg/png/webp)    → aquí dentro, con zoom
 *   · PDF                        → aquí dentro
 *   · .zip / .dcm / .stl .ply .obj → `EduVisorModal`, que monta el visor
 *     del DENTAL que corresponda (DicomSetViewer, DicomViewer2D,
 *     Model3DViewer). Los tres se IMPORTAN tal cual; el vertical solo pone
 *     el modal, el CSS y las rutas de servidor.
 *
 * Lo que decide es la EXTENSIÓN del archivo, no el `kind` de la fila: es lo
 * mismo que hace el dental y es lo único que no puede mentir. El `kind`
 * sigue existiendo en la base (lo usan el expediente, la línea de tiempo y
 * la IA), pero ya no se pregunta ni se pinta como si fuera una taxonomía
 * que alguien eligió.
 *
 * 🔴 DÓNDE VIVEN LAS NOTAS. En `EduStudy.notes`, una sola columna. En el
 * CBCT el propio visor las EDITA contra `/api/instituto/estudios/[id]/notas`
 * —por eso ahí no se repiten abajo, se vería la copia vieja mientras se
 * escribe la nueva—; en el resto se enseñan tal cual, como hasta ahora.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduEstudioViewer({
  estudio,
  patientId,
  onClose,
  iaAnalisis,
  canAnalyze,
  dict3d,
}: {
  estudio: EduStudyRow;
  patientId: string;
  onClose: () => void;
  /** Si el apoyo de IA está disponible, y si no, por qué. */
  iaAnalisis: EduIaEstado;
  canAnalyze: boolean;
  /** El trozo de diccionario que necesita el visor de mallas. */
  dict3d: Dictionary;
}) {
  const [zoom, setZoom] = useState(false);

  const sinUrl = !estudio.url;
  const tipoVisor = sinUrl ? null : eduVisorPorExtension(estudio.name);

  const subtitulo = `${estudio.sizeLabel} · subió ${estudio.uploadedByName}`;

  /* Notas, apoyo de IA y ficha del estudio. Van igual en las dos hojas: en
     la del visor quedan bajo la rejilla, a un desplazamiento — la rejilla
     se dimensiona para ocupar la primera pantalla, no para tapar esto. */
  const extras = (
    <>
      {estudio.notes && tipoVisor !== "cbct" && (
        <div>
          <span className="edu-kv__k">Notas</span>
          <p className="edu-estudio__notes">{estudio.notes}</p>
        </div>
      )}

      {/* El apoyo de IA vive DENTRO del visor y no en la galería: la
          lectura solo tiene sentido con la imagen delante. El panel se
          pinta siempre —también cuando la IA está apagada— porque su
          primer trabajo es explicar por qué lo está. */}
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

  if (tipoVisor) {
    return (
      <EduVisorModal
        studyId={estudio.id}
        patientId={patientId}
        name={estudio.name}
        url={estudio.url}
        subtitle={subtitulo}
        notes={estudio.notes}
        dict3d={dict3d}
        onClose={onClose}
      >
        {extras}
      </EduVisorModal>
    );
  }

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

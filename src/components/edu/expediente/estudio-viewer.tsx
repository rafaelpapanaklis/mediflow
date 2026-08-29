"use client";

import { useState } from "react";
import { Download, ZoomIn, ZoomOut } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { EDU_STUDY_KIND_LABELS } from "@/lib/edu/types";
import type { EduStudyRow } from "@/lib/edu/estudios-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * VISOR MÍNIMO DEL VERTICAL — y por qué es MÍNIMO a propósito.
 *
 * El dental tiene un visor CBCT de verdad
 * (src/components/patient-3d/DicomSetViewer.tsx): descomprime el .zip,
 * decodifica los cortes DICOM en un worker y pinta una rejilla 2×2 con
 * axial, coronal, sagital y volumen 3D, con cruz sincronizada en mm.
 *
 * 🔴 ESE VISOR **NO SE PUEDE IMPORTAR** AQUÍ, y no se copió.
 *
 * No es puro: su contenedor llama a `/api/patients/{patientId}/dicom-set/
 * {fileId}/lite` para generar el CBCT reducido de móvil y a
 * `PATCH /api/patients/{patientId}/models-3d/{fileId}` para guardar las
 * notas del visor. Esas dos rutas resuelven contra el `Patient` y el
 * `PatientFile` del DENTAL, con la sesión del dental: un id del instituto
 * ahí dentro no existe. Lo mismo `DicomViewer2D`.
 *
 * Copiarlo entero habría significado arrastrar ~2 400 líneas (visor + MPR
 * + volumen + panorámica + worker de decodificación) y su deuda: dos
 * copias del mismo visor que empiezan iguales y terminan distintas, y la
 * corrección de geometría que el dental acaba de pagar (una letra INVERTIDA
 * sobre la imagen de un paciente, commit c668f54f) tendría que aplicarse
 * dos veces o quedarse a medias en una de las dos. En una imagen clínica,
 * eso no es un detalle estético.
 *
 * LO QUE SÍ HACE ESTA OLA, y se dice claro en la pantalla:
 *   · imágenes (jpg/png/webp)  → se ven aquí dentro, con zoom
 *   · PDF                      → se lee aquí dentro
 *   · DICOM / .zip CBCT / mallas → se DESCARGAN. El archivo está completo
 *     y firmado; lo que no hay todavía es visor 3D del vertical.
 *
 * Las piezas PURAS del dental (`cbct-mpr-shared.ts`, `dicom-decode-core.ts`,
 * `MprPane.tsx`, `Dicom3DVolume.tsx` — ninguna importa "@/" ni llama a
 * ninguna API) sí son reutilizables tal cual el día que el vertical tenga
 * su propio contenedor. Queda anotado en ORQUESTA.md como la Ola siguiente,
 * no como un pendiente escondido.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduEstudioViewer({
  estudio,
  onClose,
}: {
  estudio: EduStudyRow;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(false);

  const sinUrl = !estudio.url;

  return (
    <EduModal
      title={estudio.name}
      subtitle={`${EDU_STUDY_KIND_LABELS[estudio.kind]} · ${estudio.sizeLabel} · subió ${estudio.uploadedByName}`}
      onClose={onClose}
      footer={
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
      }
    >
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
              <p className="edu-banner__title">
                Este archivo se descarga: todavía no hay visor 3D en el vertical
              </p>
              <p className="edu-banner__detail">
                Las tomografías (.zip de cortes DICOM, .dcm sueltos) y las mallas de escáner
                intraoral se guardan completas y se descargan con el botón de abajo. El visor CBCT
                del panel dental no se puede reutilizar aquí porque va a buscar el estudio a las
                tablas de ese otro producto; el visor propio del instituto es trabajo de la ola
                siguiente. Mientras tanto el archivo está íntegro y a un clic.
              </p>
            </div>
          </div>
        )}

        {estudio.notes && (
          <div>
            <span className="edu-kv__k">Notas</span>
            <p className="edu-estudio__notes">{estudio.notes}</p>
          </div>
        )}

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
      </div>
    </EduModal>
  );
}

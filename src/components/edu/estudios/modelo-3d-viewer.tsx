"use client";

import dynamic from "next/dynamic";
import { I18nProvider } from "@/i18n/i18n-provider";
import type { Dictionary } from "@/i18n/t";
import type { Model3DFormat } from "@/components/patient-3d/Model3DViewer";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL VISOR DE MALLAS 3D — ADAPTADOR, NO COPIA.
 *
 * `Model3DViewer` (src/components/patient-3d/Model3DViewer.tsx) se importa
 * TAL CUAL del dental: es el visor de escaneos intraorales STL/PLY/OBJ con
 * medición en mm, marcas, vistas rápidas y render bajo demanda. Copiarlo
 * serían ~1 400 líneas duplicadas, y la próxima corrección de medición del
 * dental se quedaría a medias en una de las dos copias.
 *
 * Lo que este adaptador RESUELVE (los dos únicos acoples del visor):
 *
 *  1. `useT()` — el visor lee sus textos del i18n del dashboard dental, y
 *     ese provider NO existe bajo /instituto (useT LANZA sin él). Aquí se
 *     monta un I18nProvider con el TROZO del diccionario en español que el
 *     visor usa (`patients.models3d`), que el SERVIDOR recorta y manda
 *     como prop — no viaja el diccionario entero al navegador.
 *
 *  2. La persistencia — el visor guarda notas y marcas con
 *     `PATCH /api/patients/{patientId}/models-3d/{fileId}`, que resuelve
 *     contra las tablas del DENTAL. NO se le pasan `patientId`/`fileId`:
 *     sin ellos `canPersist` es false, el panel de notas no se pinta y esa
 *     ruta es INALCANZABLE desde el instituto. Las notas del estudio ya
 *     viven en `EduStudy.notes` y se ven en el visor de la galería.
 *
 * El visor entra por `next/dynamic` con ssr:false: three.js + BVH pesan, y
 * solo los paga quien abre un modelo.
 * ═══════════════════════════════════════════════════════════════════════
 */
const Model3DViewer = dynamic(() => import("@/components/patient-3d/Model3DViewer"), {
  ssr: false,
  loading: () => (
    <div className="edu-vsr__cargando" role="status">
      Preparando el visor 3D…
    </div>
  ),
});

/** La extensión decide el formato; la URL firmada lleva query y el visor
 *  también sabe inferirlo, pero decidirlo aquí con el NOMBRE original del
 *  estudio no depende de cómo firme Storage sus URLs. */
export function eduModelo3DFormat(name: string): Model3DFormat | null {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "stl") return "stl";
  if (ext === "ply") return "ply";
  if (ext === "obj") return "obj";
  return null;
}

export function EduModelo3DViewer({
  url,
  name,
  dict3d,
}: {
  url: string;
  name: string;
  /** El trozo `{ patients: { models3d } }` del diccionario en español,
   *  recortado por el SERVIDOR (la página de estudios). */
  dict3d: Dictionary;
}) {
  const format = eduModelo3DFormat(name);
  if (!format) {
    return (
      <div className="edu-alert" role="alert">
        Este archivo no es una malla 3D (.stl, .ply, .obj). Descárgalo para abrirlo en otro
        programa.
      </div>
    );
  }
  return (
    <I18nProvider locale="es" dict={dict3d}>
      <Model3DViewer url={url} format={format} />
    </I18nProvider>
  );
}

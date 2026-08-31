"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA PANORÁMICA RECONSTRUIDA — el visor del dental, IMPORTADO tal cual.
 *
 * Qué se importa, sin una línea copiada (src/components/patient-3d/**):
 *   · PanoramicPane.tsx     → los dos lienzos: el axial donde se traza la
 *                             curva de la arcada y la panorámica que sale
 *                             del reslice, con slab MIP/promedio y la
 *                             longitud de arco en mm reales.
 *   · arch-autodetect.ts    → la detección AUTOMÁTICA de la curva (MIP de
 *                             la banda dental, umbral de Otsu, morfología,
 *                             línea central polar). Entra sola por dentro
 *                             de PanoramicPane; no hay que llamarla aquí.
 *   · panoramic-reslice.ts  → el recorte curvo propiamente dicho.
 *
 * 🔴 NO HIZO FALTA ADAPTADOR DE ACOPLES: las tres piezas son PURAS. Cero
 * fetch, cero Prisma, cero sesión, cero tabla del dental — solo reciben el
 * volumen que este visor ya tiene en memoria (`slices`, `scale`) y
 * devuelven píxeles. Se comprobó a mano: ni `/api/`, ni `patientId`, ni
 * `fileId` aparecen en ninguno de los tres archivos. Por eso lo único que
 * hay aquí es un ANFITRIÓN de tamaño, no una traducción de datos.
 *
 * Qué resuelve entonces este anfitrión, y por qué existe:
 *   1. PanoramicPane fija el alto de sus lienzos con un estilo EN LÍNEA de
 *      380 px. En el dental eso está bien —vive en un modal de alto fijo—,
 *      pero aquí el visor usa la ventana entera y ese número deja media
 *      pantalla en blanco (o no cabe). Como el archivo es del dental y no
 *      se edita, el alto se sube DESDE FUERA con la variable
 *      `--edu-pano-h`, que edu-theme.css aplica con `!important` (un
 *      `!important` de hoja de estilos sí le gana a un estilo en línea).
 *      Si mañana ese árbol cambiara, la regla deja de casar y la
 *      panorámica se queda en sus 380 px de siempre: nada se rompe.
 *   2. Le pone la MISMA barra de 34 px que llevan los demás paneles, con
 *      su botón de maximizar, para que la rejilla quede pareja.
 *
 * Por qué importa tener esto: cuando el laboratorio entrega el estudio, su
 * software dibuja la curva del arco y los cortes transversales, pero esas
 * líneas NO viajan dentro del DICOM —son del visor del lab—, así que la
 * única forma de tenerlas aquí es calcularlas. Es exactamente lo que hace
 * arch-autodetect, y por eso se importa en vez de reescribirse.
 * ═══════════════════════════════════════════════════════════════════════
 */
import dynamic from "next/dynamic";
import { Loader2, Maximize2, Minimize2, Spline } from "lucide-react";
import type { Cross, ScaleInfo, Slice } from "@/components/patient-3d/cbct-mpr-shared";
import { EDU_PANEL_CHROME } from "@/components/edu/estudios/visor-medidas";

/** El reslice curvo y la auto-detección traen su propia matemática pesada:
 *  solo la paga quien abre un CBCT, y solo cuando la celda se monta. */
const PanoramicPane = dynamic(() => import("@/components/patient-3d/PanoramicPane"), {
  ssr: false,
  loading: () => (
    <div className="edu-visor3d-cargando" role="status">
      <Loader2 className="edu-girando" size={18} /> Preparando la panorámica…
    </div>
  ),
});

/**
 * Alto que PanoramicPane gasta ALREDEDOR de sus lienzos: dos cabeceras, la
 * regleta del corte axial, la barra de slab/modo/regenerar y la nota
 * final. Es una constante y no una medición porque solo sirve para
 * REPARTIR el alto: si se queda corta por unos píxeles, la panorámica
 * sobresale un poco de su fila — no descuadra ningún panel.
 */
const EDU_PANO_CHROME = 164;

/** Suelos y techos del lienzo. Por debajo de 260 px una panorámica ya no
 *  se lee; por encima de 560 la franja crece sin aportar, porque el
 *  reslice tiene la altura del volumen y lo demás es interpolar. */
const EDU_PANO_MIN = 260;
const EDU_PANO_MAX = 560;

export interface EduPanoramicaProps {
  slices: Slice[];
  scale: ScaleInfo;
  center: number;
  width: number;
  cross: Cross;
  zPhysicalOrder: boolean;
  /** Lado del panel cuadrado de la rejilla (o el alto libre entero, si la
   *  panorámica va sola). De aquí sale `--edu-pano-h`. */
  alto: number;
  maximizado: boolean;
  onAlternarMax: () => void;
}

export function EduPanoramica({
  slices,
  scale,
  center,
  width,
  cross,
  zPhysicalOrder,
  alto,
  maximizado,
  onAlternarMax,
}: EduPanoramicaProps) {
  // En la rejilla, el lienzo de la panorámica mide LO MISMO que la imagen
  // de un plano (el lado del cuadrado menos su barra): así la fila de la
  // panorámica se lee como parte del mismo juego y no como un pegote.
  // Maximizada no hay cuadrado con el que casar y se le da todo el hueco,
  // que es lo que uno espera de "maximizar".
  const objetivo = Math.round(alto) - (maximizado ? EDU_PANO_CHROME : EDU_PANEL_CHROME);
  const altoLienzo = maximizado
    ? Math.max(EDU_PANO_MIN, objetivo)
    : Math.max(EDU_PANO_MIN, Math.min(EDU_PANO_MAX, objetivo));

  return (
    <div
      className="edu-visor3d-pano"
      style={{ "--edu-pano-h": `${altoLienzo}px` } as React.CSSProperties}
    >
      <div className="edu-visor3d-pano__caja">
        <PanoramicPane
          slices={slices}
          scale={scale}
          center={center}
          width={width}
          // El corte axial sobre el que se traza arranca donde está la cruz
          // del MPR. Después es suyo: mover la cruz no le mueve el trazo,
          // que es lo que uno quiere mientras dibuja la arcada.
          initialZ={cross.z}
          zPhysicalOrder={zPhysicalOrder}
        />
      </div>

      <div className="edu-visor3d-pane__barra">
        <span className="edu-visor3d-pane__nombre">
          <Spline size={13} aria-hidden /> Panorámica
        </span>
        <button
          type="button"
          className="edu-visor3d-pane__max"
          onClick={onAlternarMax}
          title={maximizado ? "Restaurar la rejilla" : "Maximizar la panorámica"}
          aria-label={maximizado ? "Restaurar la rejilla" : "Maximizar la panorámica"}
        >
          {maximizado ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}

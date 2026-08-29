// Franja de ADVERTENCIA del visor CBCT/DICOM: se monta ARRIBA del visor cuando el
// orden de los cortes —y con él la escala a lo largo de Z— NO se puede dar por
// bueno. Es hermana de DiagnosticDisclaimer.tsx, pero no dice lo mismo: aquella es
// una nota legal de fondo, permanente e idéntica para todos los estudios; ésta
// habla de ESTE estudio en concreto y solo aparece cuando hay motivo. Por eso usa
// el ámbar de aviso que el módulo ya emplea (Models3DTab, la nota del CBCT ≠ HU)
// en lugar del gris de fondo — pero con la misma medida discreta: una línea de
// 11px, sin caja llamativa.
//
// Presentacional puro (sin hooks ni estado), como su hermana: se puede montar en
// cualquier superficie sin depender del provider i18n. El texto llega por prop y,
// si falta, cae al respaldo en español.
//
// role="note" y NO role="alert": la franja está desde el primer pintado del visor,
// no aparece como reacción a una acción del usuario. `alert` es asertivo e
// interrumpe al lector de pantalla — aquí sería gritar por algo que ya está
// escrito en pantalla y no va a cambiar.
//
// Aquí vive TAMBIÉN el predicado que decide si hay que avisar
// (`geometryDoubtReason`), fuera del componente y sin React: quien carga el
// estudio necesita ese juicio en un `useMemo` para decidir Y para explicar, no
// dentro de un JSX que solo sabe pintar.

import { AlertTriangle } from "lucide-react";
import type { SliceOrderSource } from "./dicom-decode-core";
import type { CbctLiteSourceGeometry } from "./cbct-lite-shared";

// Texto exacto de la advertencia. Se exporta porque el visor puede querer
// reutilizarlo (tooltip, informe) sin duplicar la redacción.
export const GEOMETRY_WARNING_TEXT =
  "Geometría no verificada: las mediciones de este estudio pueden no ser exactas.";

export default function GeometryWarning({
  text,
  detail,
  className = "",
}: {
  text?: string;
  /** Frase corta que explica POR QUÉ (ver GEOMETRY_DOUBT_DETAIL). Opcional. */
  detail?: string;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-[11px] leading-snug text-amber-800 dark:text-amber-200 ${className}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden />
      <span>
        {text || GEOMETRY_WARNING_TEXT}
        {detail ? <span className="opacity-80"> {detail}</span> : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PREDICADO (puro, sin React) — ¿hay que avisar, y por qué?
// ---------------------------------------------------------------------------

// Motivo por el que la geometría de un estudio no es de fiar. Tipado (y no un
// booleano) para que el llamador pueda además EXPLICARLO: un aviso que no dice
// qué le pasa al estudio se acaba ignorando.
//   "no-position"  → ningún corte trae ImagePositionPatient: el orden salió de
//                    InstanceNumber o del índice de entrada del .zip, y la
//                    separación entre cortes es la declarada, no la medida.
//   "mixed-order"  → SOLO UNA PARTE de los cortes trae posición. Es el caso MÁS
//                    grave, no el intermedio: los `order` de las dos ramas están
//                    en unidades distintas (mm con signo vs. índice entero), así
//                    que ordenarlos no arriesga una inversión — INTERCALA las dos
//                    familias y baraja el volumen.
//   "same-position"→ TODOS los cortes declaran la misma ImagePositionPatient. Es
//                    la trampa más silenciosa de todas: el estudio pasa cualquier
//                    comprobación de "¿trae posición?" —la trae, y en los 300
//                    cortes— y sin embargo esa posición no ordena nada, así que la
//                    pila quedó en el orden en que venía dentro del .zip. Antes
//                    era el único caso de geometría demostradamente inservible que
//                    no producía ni un aviso.
//   "mixed-series" → los cortes no comparten ImageOrientationPatient: en el mismo
//                    archivo hay más de una adquisición (lo típico: el volumen y
//                    un scout lateral). No es solo desorden — el visor rotula todo
//                    el volumen con la orientación del primer corte, así que un
//                    plano puede acabar pintando una imagen de la otra serie con
//                    las letras de ésta.
//   "variable-z"   → el espaciado medido entre cortes consecutivos no es
//                    constante; `sz` es la mediana y cualquier medida a lo largo
//                    de Z arrastra ese error.
export type GeometryDoubtReason =
  | "no-position"
  | "mixed-order"
  | "same-position"
  | "mixed-series"
  | "variable-z";

// Evidencia con la que se juzga el estudio. Es una UNIÓN DISCRIMINADA a propósito,
// no un objeto con campos opcionales: en la ruta móvil el `orderSource` de los
// cortes SIEMPRE vale "instance" (el binario lite no transporta geometría de
// paciente), así que si se pudieran pasar los cortes por esa ruta, cada usuario de
// móvil vería la advertencia en TODOS los estudios y sería FALSA. Con la unión, la
// ruta "lite" ni siquiera tiene dónde meter los cortes: el falso positivo deja de
// ser un descuido posible y pasa a ser un error de compilación.
export type GeometryEvidence =
  | {
      // ESCRITORIO: el .zip completo, ya decodificado. La procedencia del orden se
      // lee de los propios cortes, que sí traen la geometría del estudio.
      route: "full";
      orderSources: readonly SliceOrderSource[];
      // Las posiciones existen pero NO separan: todos los cortes en el mismo
      // sitio. Lo mide measureZSpacing, que es quien tiene los milímetros; aquí
      // solo se juzga.
      samePosition?: boolean;
      // Los cortes no comparten orientación de adquisición (ver sameOrientation).
      mixedSeries?: boolean;
      zVariable?: boolean;
    }
  | {
      // MÓVIL: volumen reducido. El juicio sale del TRI-ESTADO de la cabecera del
      // binario (procedencia del estudio ORIGINAL, propagada por buildCbctLite),
      // nunca de los cortes que devuelve decodeCbctLite.
      route: "lite";
      sourceGeometry: CbctLiteSourceGeometry;
      // El servidor tuvo que descartar cortes de otro raster al construir el
      // binario. Viaja en la cabecera porque el móvil recibe el volumen YA
      // filtrado: los cortes que lo delatarían no están, y sin este bit el mismo
      // .zip con dos series avisaba en el escritorio y se veía impecable en el
      // teléfono.
      mixedSeries?: boolean;
      zVariable?: boolean;
    };

/**
 * Decide si la geometría del estudio es poco fiable y por qué.
 *
 * Devuelve `null` cuando no hay nada que advertir. Criterio de fondo: solo se
 * avisa de lo que CONSTA que está mal, nunca de lo que no se pudo comprobar —
 * un aviso permanente que no distingue estudios buenos de malos no informa, se
 * vuelve ruido y acaba tapando al que sí importaba.
 *
 * Por eso `"unknown"` en la ruta lite (binarios generados antes de que el
 * formato transportara la procedencia) NO dispara el aviso: no consta que el
 * estudio original tuviera posiciones, pero tampoco consta que no las tuviera.
 */
export function geometryDoubtReason(ev: GeometryEvidence): GeometryDoubtReason | null {
  if (ev.route === "full") {
    // Solo cuentan los cortes que DECLARAN su procedencia. El tipo ya la exige,
    // pero por aquí pasan también cortes rescatados del IndexedDB del navegador,
    // y un registro guardado por una versión anterior del visor no la trae. Hoy
    // ese caso no llega (dicom-cache lo rechaza en la lectura y fuerza un
    // redecodificado), y aun así no se cuenta como dudoso: un campo que falta es
    // una ignorancia nuestra, no un defecto del estudio del paciente.
    let declared = 0;
    let positioned = 0;
    for (const src of ev.orderSources) {
      if (src === "position") {
        positioned++;
        declared++;
      } else if (src === "instance") {
        declared++;
      }
    }
    if (declared > 0) {
      // Se comprueba el orden ANTES que el espaciado: un volumen barajado o
      // apilado a ciegas es un problema mayor que un espaciado irregular, y el
      // motivo que se muestra debe ser el peor de los que aplican.
      if (positioned === 0) return "no-position";
      if (positioned !== declared) return "mixed-order";
      // Aquí TODOS declaran posición, que es el caso bueno... salvo estos dos, en
      // los que la posición está pero no sirve para lo que el visor la usa. Van
      // después de los de arriba y antes del espaciado por la misma regla: se
      // muestra el peor motivo que aplique, y un volumen mal apilado o con dos
      // series dentro invalida más cosas que un paso irregular.
      if (ev.samePosition) return "same-position";
      if (ev.mixedSeries) return "mixed-series";
    }
    // declared === 0 (aún no hay cortes) = no hay evidencia: no se juzga.
  } else if (ev.sourceGeometry === "unpositioned") {
    // El lite no distingue "sin posición en ninguno" de "posición solo en unos
    // cuantos": el generador colapsa ambos casos en "unpositioned" (ver
    // buildCbctLite). Se reporta el motivo genérico, que es cierto en los dos.
    return "no-position";
  } else if (ev.mixedSeries) {
    // Mismo orden que en la ruta de escritorio: el reparto de series pesa más que
    // un espaciado irregular, así que se comprueba antes.
    return "mixed-series";
  }
  if (ev.zVariable) return "variable-z";
  return null;
}

// Frase corta que acompaña al aviso para que el motivo se entienda sin abrir el
// código. Se mantiene en el mismo registro que el resto del visor: dice lo que
// pasa, no lo que el usuario debería sentir.
export const GEOMETRY_DOUBT_DETAIL: Record<GeometryDoubtReason, string> = {
  "no-position":
    "El estudio no trae la posición de cada corte: su orden y su separación son una suposición, no una medida.",
  "mixed-order":
    "Solo una parte de los cortes trae posición: al apilarlos se mezclan dos criterios de orden distintos.",
  "same-position":
    "Todos los cortes declaran la misma posición: el estudio no dice en qué orden van ni a qué distancia están.",
  "mixed-series":
    "Los cortes no comparten orientación: parece haber más de una serie dentro del mismo archivo.",
  "variable-z": "La separación entre cortes no es constante en todo el estudio.",
};

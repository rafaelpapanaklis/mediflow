"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef } from "react";
// `import type` y no `import`: el tipo se borra al compilar, así que estas dos
// líneas NO arrastran three.js al bundle de la pantalla que las usa. El visor
// entero entra por el `dynamic()` de abajo, en su propio trozo.
import type { LayoutElement, LayoutMetadata } from "@/components/clinic-3d/world-types";
import type { Clinic3DHost, Clinic3DPick } from "@/components/clinic-3d/Clinic3DClient";

export type { Clinic3DPick };

/**
 * EL MUNDO 3D COMO PISO DE LAS PANTALLAS "EN VIVO" DEL DENTAL.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NO HAY UN VISOR NUEVO, Y NO VA A HABERLO.
 *
 * `Clinic3DClient` son 800 renglones que cuelgan de otros veinte archivos
 * (arquitectura, mobiliario, capa viva, colisión, dron, VR, minimapa…) y ya
 * los monta este mismo producto en /dashboard/clinic-layout/3d y en
 * /live/[slug]/3d. Aquí se monta UNA TERCERA VEZ, en otro sitio, con las
 * mismas piezas: ni se copia el visor ni se toca `src/components/clinic-3d/`
 * —esa carpeta la comparten el dental, el instituto y las escuelas, y una
 * corrección de allá tiene que llegar a las tres pantallas sola—.
 *
 * El planteamiento es el del instituto (src/components/edu/clinica/
 * plano-mundo.tsx), no el archivo: un envoltorio delgado que carga el visor
 * por `dynamic()` y le pasa `host`.
 *
 * ── ESTO ES UNA VISTA DE ESTADO, NO UN PASEO ───────────────────────────
 * 🔴 El visor del dental es un recorrido en PRIMERA PERSONA: se camina con
 * WASD, hay una mano en pantalla, una mira en el centro y la vista aérea es
 * un modo alterno. En estas dos pantallas eso está AL REVÉS y no por gusto:
 * quien las abre es la recepción mirando el piso —"¿qué sillón está
 * libre?"—, no alguien que quiere pasear por su clínica. Con `host` presente
 * el visor arranca en la vista AÉREA, encuadrando la clínica completa, y NO
 * hay forma de pasar a primera persona: ni se montan los controles de
 * caminar, ni la mano, ni la mira, ni el mando que alterna. Se gira con el
 * ratón y se acerca con la rueda, que es lo que se le pide a un plano.
 *
 * El recorrido a pie sigue existiendo y sigue siendo el de siempre:
 * /dashboard/clinic-layout/3d y /live/[slug]/3d, intactos. Esta pantalla
 * enlaza al que le toca.
 *
 * ── EL MODO PÚBLICO NO SE RELAJA ───────────────────────────────────────
 * 🔴 En /live/[slug] se pasan LAS DOS props: `publicMode` y `host`. No es
 * redundante y el orden de precedencia está escrito dentro del visor:
 *   · `publicMode` manda en LOS DATOS — sondea /api/live/[slug] (ya
 *     enmascarado en el servidor) y lo traduce con `adaptPublicLiveChairs`,
 *     que fuerza `patientId: null`. Sin patientId la capa viva no marca
 *     ningún avatar como interactuable: en público es IMPOSIBLE abrir un
 *     expediente. Y sin `publicMode` el visor pediría el estado PRIVADO del
 *     dueño (con nombres completos y patientId) desde una página sin sesión.
 *   · `host` manda en LA CÁMARA y en el clic (vista aérea, sin caminar, y
 *     el clic lo resuelve quien monta, no una ruta del dental).
 * Quitar `publicMode` de la vista pública es exactamente la fuga que el
 * adaptador existe para impedir.
 */

const Clinic3DClient = dynamic(
  () => import("@/components/clinic-3d/Clinic3DClient").then((m) => m.Clinic3DClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#0b0d11] text-white/70">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <span className="ml-3 text-sm">Cargando el piso en 3D…</span>
      </div>
    ),
  },
);

/**
 * ¿Este navegador sabe pintar el mundo?
 *
 * Se pregunta con un canvas de usar y tirar, que es la única respuesta
 * honesta: `navigator.gpu` o el user-agent no dicen si el driver está
 * bloqueado.
 *
 * 🔴 SE PREGUNTA UNA VEZ Y SE SUELTA EL CONTEXTO. Un contexto WebGL no se
 * recoge solo: el navegador aguanta ~16 vivos a la vez y, pasado el tope,
 * empieza a NEGARLOS —o a matar el más viejo, que sería justo el del
 * mundo—. Esta función corre en cada `resize`, así que sin `loseContext()`
 * y sin memoria bastaba con mover la ventana unas cuantas veces para que
 * contestara "este navegador no puede" en un navegador que sí podía.
 * (La misma lección que costó verla en el plano del instituto.)
 */
let webglCache: boolean | null = null;
export function hayWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    webglCache = !!gl;
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** Debajo de este ancho manda el plano de siempre (2D). */
export const ANCHO_MIN_3D = 768;

export interface MundoGeometria {
  elements: LayoutElement[];
  metadata: LayoutMetadata | null;
  chairs: { id: string; name: string; color: string | null }[];
}

/**
 * LA GEOMETRÍA DEL MUNDO, CON IDENTIDAD ESTABLE.
 *
 * 🔴 ESTO NO ES HIGIENE: ES LA DIFERENCIA ENTRE UN TELEVISOR QUE AGUANTA
 * TODO EL DÍA Y UNO QUE SE MUERE.
 *
 * `Clinic3DClient` recalcula el mundo entero con un `useMemo` sobre
 * `initialElements`, `initialMetadata` e `initialChairs`, y su efecto
 * depende de ese mundo. Si el padre les cambia la IDENTIDAD, el efecto se
 * vuelve a montar: destruye la escena, tira el renderer, suelta el contexto
 * WebGL y reconstruye treinta sillones… y de paso pierde dónde estaba
 * mirando la cámara.
 *
 * En el instituto eso no pasa porque sus props vienen del servidor y no se
 * mueven en toda la sesión. Aquí SÍ se mueven: la vista pública sanea el
 * payload en CADA sondeo (cada 30 s) y `sanitizeLiveData` devuelve arrays
 * nuevos aunque el plano no haya cambiado ni una silla. Pasarlos tal cual
 * era reconstruir el mundo dos veces por minuto, para siempre.
 *
 * Así que la identidad se congela contra una FIRMA del contenido: mientras
 * el plano diga lo mismo, se devuelve exactamente el mismo objeto. Y cuando
 * el dueño mueve de verdad un sillón, la firma cambia, el mundo se
 * reconstruye una vez y la pantalla se entera sola.
 */
export function useMundoEstable(
  elements: LayoutElement[],
  metadata: LayoutMetadata | null,
  chairs: { id: string; name: string; color: string | null }[],
): MundoGeometria {
  const ref = useRef<{ firma: string; valor: MundoGeometria } | null>(null);
  return useMemo(() => {
    // Solo lo que el mundo mira: posición/tipo/giro de cada elemento, el
    // sillón al que apunta, la rejilla y el nombre/color de cada sillón. El
    // resto del payload (citas, sala de espera, reloj) cambia cada 30 s y
    // NO debe reconstruir nada.
    //
    // ⚠️ Las tres dependencias son las de arriba y NO un objeto armado en el
    // padre: un `{ elements, metadata, chairs }` en línea es nuevo en CADA
    // render, y el televisor re-renderiza una vez por segundo (el reloj).
    // Así la firma se calcula cuando el payload cambia —una vez cada 30 s—,
    // no sesenta veces por minuto.
    const firma = JSON.stringify([
      elements.map((e) => [e.id, e.type, e.col, e.row, e.rotation ?? 0, e.resourceId ?? ""]),
      metadata?.gridSize ?? null,
      chairs.map((c) => [c.id, c.name, c.color ?? ""]),
    ]);
    if (ref.current?.firma !== firma) ref.current = { firma, valor: { elements, metadata, chairs } };
    return ref.current.valor;
  }, [elements, metadata, chairs]);
}

export interface LiveWorldProps {
  clinic: { id: string; name: string; category: string };
  /** Geometría YA estabilizada (ver `useMundoEstable`). */
  mundo: MundoGeometria;
  /**
   * Ruta del estado vivo. En modo público NO se usa: manda /api/live/[slug]
   * (lo decide el visor). Se pasa igual para que quede escrito de dónde sale
   * el latido de esta pantalla.
   */
  endpoint: string;
  /** slug público → el visor corre en MODO PÚBLICO. null = panel del dueño. */
  publicSlug?: string | null;
  /** Cada payload del sondeo, para que la pantalla no monte un SEGUNDO. */
  onState?: (payload: unknown) => void;
  /** Clic sobre un sillón: la pantalla decide qué enseñar. */
  onPick: (pick: Clinic3DPick) => void;
  /** La leyenda del HUD (la del dental habla de agendar y de expedientes). */
  legend: string[];
}

export function LiveWorld({
  clinic,
  mundo,
  endpoint,
  publicSlug = null,
  onState,
  onPick,
  legend,
}: LiveWorldProps) {
  // El objeto se recrea y da igual: el visor lo lee por ref (para no quedarse
  // con los enganches del primer render) y su efecto solo depende del mundo.
  const host = useMemo<Clinic3DHost>(
    () => ({ state: endpoint, onState, onPick, legend }),
    [endpoint, onState, onPick, legend],
  );

  return (
    <Clinic3DClient
      clinic={clinic}
      initialElements={mundo.elements}
      initialMetadata={mundo.metadata}
      initialChairs={mundo.chairs}
      publicMode={publicSlug ? { slug: publicSlug } : null}
      host={host}
    />
  );
}

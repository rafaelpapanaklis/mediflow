"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { LayoutElement, LayoutMetadata } from "@/components/clinic-3d/world-types";
// `import type` y no `import`: el tipo se borra al compilar, así que esta
// línea NO arrastra three.js al bundle de la pantalla. El visor entero
// entra por el `dynamic()` de abajo, en su propio trozo y solo aquí.
import type { Clinic3DHost, Clinic3DPick } from "@/components/clinic-3d/Clinic3DClient";

/**
 * EL MUNDO 3D DEL DENTAL, MONTADO EN EL INSTITUTO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NO HAY UN VISOR PROPIO, Y NO VA A HABERLO.
 *
 * `Clinic3DClient` son 800 renglones que cuelgan de otros veinte archivos
 * (arquitectura, mobiliario, capa viva, colisión, dron, VR, minimapa…).
 * Copiarlo aquí sería duplicar todo eso y su deuda, y la próxima corrección
 * del dental —una pared que no colisiona, una fuga de texturas— habría que
 * aplicarla dos veces o se quedaría a medias en una de las dos copias. Es
 * la MISMA decisión que tomó el visor de estudios con `DicomSetViewer`, y
 * la misma que el odontograma y el motor de la agenda.
 *
 * Lo único que hizo falta del otro lado fue UNA prop opcional (`host`),
 * porque el visor trae escritas a mano cosas que solo valen para el dental:
 * la ruta de su estado vivo, a dónde lleva el clic (el expediente del
 * dental), el "Dr." de la placa flotante y los textos de su HUD. Sin esa
 * prop el dental se comporta igual línea por línea; con ella, este vertical
 * le pone las suyas. Un adaptador no puede redirigir un fetch escrito
 * dentro.
 *
 * ── ESTO ES UNA VISTA DE ESTADO, NO UN VIDEOJUEGO ──────────────────────
 * 🔴 El visor del dental es un recorrido en PRIMERA PERSONA: se camina con
 * WASD, hay una mano en pantalla, una mira en el centro y la vista aérea es
 * un modo alterno. Aquí eso está AL REVÉS y no por gusto: quien abre esta
 * pantalla es la dirección de una escuela mirando el piso —"¿qué sillón
 * está libre?"—, no alguien que quiere pasear. Con `host` presente el visor
 * arranca en la vista AÉREA, encuadrando la sede completa, y NO hay forma
 * de pasar a primera persona: ni se montan los controles de caminar, ni la
 * mano, ni la mira, ni el mando que alterna. Se gira con el ratón y se
 * acerca con la rueda, que es lo que se le pide a un plano.
 *
 * ── EL CLIC ────────────────────────────────────────────────────────────
 * `host.onPick` avisa QUÉ se tocó (la figura del paciente, la del
 * estudiante o el sillón) y esta pantalla decide qué enseñar. El id del
 * paciente NO viaja en el estado del mundo: la tarjeta lo saca del mismo
 * payload que ya tiene en memoria (ver plano-screen.tsx).
 *
 * ── LAS PROPS DEL MUNDO NO PUEDEN CAMBIAR DE IDENTIDAD ─────────────────
 * ⚠️ `Clinic3DClient` recalcula el mundo entero con un `useMemo` sobre
 * `initialElements`, `initialMetadata` e `initialChairs`. Si el padre crea
 * arrays nuevos en cada render, el efecto se vuelve a montar: destruye la
 * escena, pierde la posición de la cámara y vuelve a construir treinta
 * sillones. Aquí llegan tal cual del servidor (identidad estable entre
 * renders de cliente) y esta pantalla NO las toca.
 */

const Clinic3DClient = dynamic(
  () => import("@/components/clinic-3d/Clinic3DClient").then((m) => m.Clinic3DClient),
  {
    ssr: false,
    loading: () => (
      <div className="edu-plano__cargando">
        <span className="edu-plano__spin" aria-hidden="true" />
        <span>Cargando el plano en 3D…</span>
      </div>
    ),
  },
);

export interface EduPlanoMundoProps {
  campus: { id: string; name: string };
  elements: LayoutElement[];
  metadata: LayoutMetadata | null;
  chairs: { id: string; name: string; color: string | null }[];
  /** La ruta del estado vivo de ESTA sede (sustituye la del dental). */
  endpoint: string;
  /** Cada payload del sondeo, para que la pantalla no monte un segundo. */
  onEstado: (payload: unknown) => void;
  /** Clic sobre un sillón: la pantalla abre su tarjeta. */
  onPick: (pick: Clinic3DPick) => void;
}

/**
 * Cómo nombra la placa flotante a las dos figuras.
 *
 * 🔴 En una escuela quien atiende NO es un doctor: es un ESTUDIANTE, y
 * decirle "Dr." delante de su paciente es exactamente lo que el vertical
 * lleva una ola entera corrigiendo (ver la ola de TEXTOS). El "Dr." está
 * escrito dentro de la capa viva del dental, así que se le pasa el prefijo.
 */
const PLACA = { patient: "Paciente · ", doctor: "Estudiante · " } as const;

/**
 * La leyenda del HUD. La del dental dice "clic para agendar" y "clic para
 * ver expediente" —dos cosas que aquí no pasan: el clic abre la tarjeta del
 * sillón, dentro de esta misma pantalla—.
 */
const LEYENDA = ["Clic al paciente o al estudiante para abrir su ficha"];

export function EduPlanoMundo({
  campus,
  elements,
  metadata,
  chairs,
  endpoint,
  onEstado,
  onPick,
}: EduPlanoMundoProps) {
  // El objeto se recrea en cada render y da igual: el visor lo lee por ref
  // (para no quedarse con los enganches del primer render) y su efecto solo
  // depende del mundo. El useMemo es higiene, no una necesidad.
  const host = useMemo<Clinic3DHost>(
    () => ({ state: endpoint, onState: onEstado, onPick, plate: PLACA, legend: LEYENDA }),
    [endpoint, onEstado, onPick],
  );

  return (
    <Clinic3DClient
      clinic={{
        id: campus.id,
        name: campus.name,
        // La categoría manda la PALETA y el catálogo de elementos. "DENTAL"
        // es la del piso clínico de una escuela de odontología: los mismos
        // sillones, los mismos gabinetes y el mismo suelo.
        category: "DENTAL",
      }}
      initialElements={elements}
      initialMetadata={metadata}
      initialChairs={chairs}
      host={host}
    />
  );
}

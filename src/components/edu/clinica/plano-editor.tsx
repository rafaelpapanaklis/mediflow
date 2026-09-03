"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import { C as ISO_C, fromScreen, toScreen } from "@/lib/floor-plan/iso";
import type { LayoutElement, Rotation } from "@/lib/floor-plan/element-types";
import {
  EDU_PLANO_AUTOSAVE_MS,
  EDU_PLANO_GRID_MAX,
  EDU_PLANO_GRID_MIN,
  EDU_PLANO_MAX_ELEMENTOS,
  EDU_PLANO_TIPO_SILLON,
  eduPlanoEsSillon,
  eduPlanoRevision,
  type EduPlanoChair,
  type EduPlanoLayout,
} from "@/lib/edu/plano-core";
// ── La capa visual COMPARTIDA (src/components/floor-plan) ──────────────
import { IsoElement, IsoGhost, IsoTiles } from "@/components/floor-plan/iso-canvas";
import {
  FloorBar,
  FloorCanvasBox,
  FloorPalette,
  FloorPaletteItem,
  FloorPanel,
  FloorPanelGroup,
  FloorPanelHelp,
  FloorPanelTitle,
  FloorWorkbench,
} from "@/components/floor-plan/floor-chrome";

/**
 * /instituto/clinica/plano — ACOMODAR EL PISO (solo DIRECCIÓN).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL CATÁLOGO, LA MATEMÁTICA Y AHORA TAMBIÉN EL DIBUJO SON COMPARTIDOS
 *
 * Se IMPORTAN `getCatalogForClinic` (el catálogo isométrico: paredes,
 * sillón, gabinete, mostrador, baño, mobiliario) y `fromScreen` de
 * src/lib/floor-plan/, y el DIBUJO entero —baldosas, mueble, etiqueta,
 * fantasma, marca de selección— de src/components/floor-plan/. Ese último
 * trozo lo pintaban por separado esta pantalla, el editor del dental y el
 * televisor de /live: tres bucles calcados sobre las mismas cadenas SVG.
 *
 * ⛔ Lo que sigue SIN compartirse es el COMPORTAMIENTO del editor
 * (src/app/dashboard/clinic-layout/layout-client.tsx, 1 500 renglones):
 * está atado a sus rutas (`/api/clinic-layout`), a sus Resources, a su
 * modo En Vivo, a su optimizador y a su i18n; y arrastra con
 * `requestAnimationFrame` sobre un `viewBox` fijo mientras aquí el SVG se
 * dibuja a su tamaño real y el hueco se desplaza solo. Son dos formas
 * legítimas de resolver lo mismo y unificarlas sería reescribir el editor
 * que once clínicas usan hoy. Aquí hace falta además otra cosa —ligar cada
 * sillón a un `EduChair` de ESTA sede— y eso es un editor propio de
 * trescientos renglones, no un fork de mil quinientos.
 *
 * ── LO QUE ESTA PANTALLA TIENE QUE HACER BIEN ──────────────────────────
 * 🔴 La liga sillón↔unidad. Un elemento "sillón" sin `resourceId` es un
 * mueble bonito: NO se pinta en vivo, porque el mundo 3D solo crea ancla
 * para los que la llevan. Por eso se marca en rojo en el lienzo, se cuenta
 * arriba y hay una lista de "sillones que faltan" con un botón para
 * ponerlos. Guardar CON sillones sin ligar se permite —se dibuja primero y
 * se liga después— pero no se puede guardar en silencio.
 *
 * ── EL LIENZO NO SE ARRASTRA, SE DESPLAZA ──────────────────────────────
 * El SVG se dibuja a su tamaño real (`viewBox` calculado de la rejilla) y
 * el contenedor tiene scroll. Así no hay estado de "pan" que mantener ni
 * un botón de mano que pelearse con el de mover, y el zoom es un simple
 * multiplicador del ancho en píxeles: la conversión ratón→celda sale de la
 * caja del SVG y de su viewBox, que ya llevan el zoom dentro.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ARRASTRE ES DE POINTER EVENTS, Y LO CONFIRMA EL `pointerup`
 *
 * La primera versión tomaba el elemento en `mousedown`, lo seguía en el
 * `mousemove` del SVG y confirmaba el movimiento en el `click` del SVG. Con
 * un arrastre de verdad —presionar, mover, soltar— ese `click` no llega
 * donde se le espera: el navegador lo manda al ancestro común del
 * pointerdown y el pointerup, que con el ratón fuera del elemento puede no
 * ser el lienzo, y el sillón volvía a su celda. Se movía "a dos clics" y
 * nadie lo descubría solo.
 *
 * Ahora: `pointerdown` sobre el elemento TOMA y hace `setPointerCapture`,
 * así que todos los `pointermove` siguientes llegan al elemento aunque el
 * dedo se salga del SVG; `pointermove` sigue; `pointerup` CONFIRMA la celda
 * si está dentro de la rejilla y libre. Funciona igual con ratón, con dedo
 * y con lápiz, que es lo que hace Pointer Events y no hacía `mousedown`.
 * Un clic sin mover sigue siendo SELECCIONAR y no ensucia la historia
 * (destino == origen ⇒ no se llama a `cambiar`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SE GUARDA SOLO, Y CUANDO FALLA LO DICE
 *
 * El guardado era un botón. Acomodar el piso son veinte arrastres y una
 * pantalla que se abandona; salir sin pulsarlo tiraba el trabajo con un
 * aviso de "cambios sin guardar" que es fácil de no ver. Ahora cada cosa
 * que cambia el plano —soltar, girar, poner, borrar, ligar, cambiar el
 * tamaño del piso— programa un guardado a `EDU_PLANO_AUTOSAVE_MS`, y el
 * botón se queda para forzarlo.
 *
 * ⚠️ Un guardado que falla NO se reintenta solo con el mismo contenido: un
 * error de validación (un sillón de otra sede, dos ligados a la misma
 * unidad) se repetiría cada segundo para siempre. Se pinta el error del
 * servidor en grande y el siguiente cambio vuelve a intentarlo.
 */

export interface EduPlanoEditorProps {
  campus: { id: string; name: string; code: string };
  chairs: EduPlanoChair[];
  layout: EduPlanoLayout;
}

/** Márgenes del viewBox: los elementos se dibujan HACIA ARRIBA de su celda. */
const PAD_X = 120;
const PAD_ARRIBA = 190;
const PAD_ABAJO = 90;

const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.4;

type Herramienta = { tipo: "mover" } | { tipo: "poner"; key: string };

/** Un elemento en la mano: de dónde salió, dónde está y si ya se movió. */
interface Arrastre {
  id: number;
  col: number;
  row: number;
  desdeCol: number;
  desdeRow: number;
  pointerId: number;
  /** true en cuanto cambia de celda: distingue arrastrar de seleccionar. */
  movido: boolean;
}

export function EduPlanoEditor({ campus, chairs, layout }: EduPlanoEditorProps) {
  const catalogo = useMemo(() => getCatalogForClinic("DENTAL"), []);

  const [elements, setElements] = useState<LayoutElement[]>(layout.elements);
  const [historia, setHistoria] = useState<LayoutElement[][]>([]);
  const [grid, setGrid] = useState(() => ({
    cols: layout.metadata.gridSize?.cols ?? 32,
    rows: layout.metadata.gridSize?.rows ?? 24,
  }));
  const [zoom, setZoom] = useState(0.72);
  const [herramienta, setHerramienta] = useState<Herramienta>({ tipo: "mover" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ col: number; row: number } | null>(null);
  const [moviendo, setMoviendo] = useState<Arrastre | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoISO, setGuardadoISO] = useState<string | null>(layout.savedAtISO);
  const [error, setError] = useState<string | null>(null);
  /** Un recado corto para el que suelta un sillón donde no cabe. */
  const [aviso, setAviso] = useState<string | null>(null);
  /** Los sillones que el servidor puso solo y nadie ha acomodado todavía. */
  const [pendientes, setPendientes] = useState<string[]>(() => layout.pendientes ?? []);

  /**
   * LA VERSIÓN DEL PLANO. Sube en cada cambio; el guardado apunta cuál
   * mandó y solo se da por limpio si nadie tocó nada mientras viajaba. Con
   * un simple booleano "sucio", un cambio hecho durante el guardado se
   * marcaría como guardado sin haberse mandado nunca.
   */
  const [version, setVersion] = useState(0);
  const [guardada, setGuardada] = useState(0);
  const versionRef = useRef(0);
  const guardandoRef = useRef(false);
  /** La versión cuyo guardado falló: no se reintenta sola (bucle de errores). */
  const fallidaRef = useRef<number | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  /** El espejo de `elements` para leerlo sin depender del render en curso. */
  const elementsRef = useRef<LayoutElement[]>(layout.elements);
  /** true entre el `pointerup` de un arrastre y el `click` que viene detrás. */
  const arrastreRef = useRef(false);
  /**
   * 🔴 EL ELEMENTO EN LA MANO VIVE EN UNA REFERENCIA, no solo en el estado.
   *
   * Los tres manejadores del gesto leen de aquí. Con el estado, el
   * `pointermove` que llega ANTES de que React repinte —y llega: el primero
   * suele caer en el mismo tic que el `pointerdown`— ve todavía `null` en su
   * cierre y descarta el movimiento; el sillón se quedaba quieto y el
   * `pointerup` lo daba por "clic sin mover". Pasó de verdad al arrastrar
   * rápido. El estado sigue existiendo porque es lo que DIBUJA el sillón en
   * su celda de destino mientras lo llevas.
   */
  const moviendoRef = useRef<Arrastre | null>(null);

  /** Toma (o suelta) el elemento: la referencia y el estado, siempre juntos. */
  const tomar = useCallback((a: Arrastre | null) => {
    moviendoRef.current = a;
    setMoviendo(a);
  }, []);

  const sucio = version > guardada;

  /** Marca que el plano cambió: es lo que dispara el guardado automático. */
  const marcar = useCallback(() => {
    versionRef.current += 1;
    setVersion(versionRef.current);
    setError(null);
  }, []);

  const revision = useMemo(() => eduPlanoRevision(elements, chairs), [elements, chairs]);
  const seleccionado = useMemo(
    () => elements.find((e) => e.id === selectedId) ?? null,
    [elements, selectedId],
  );

  /** Los sillones activos, por id: lo que necesita saber si algo se pinta en vivo. */
  const sillonPorId = useMemo(() => {
    const m = new Map<string, EduPlanoChair>();
    for (const c of chairs) m.set(c.id, c);
    return m;
  }, [chairs]);

  /**
   * Cambiar los elementos SIEMPRE por aquí: apila la historia y ensucia.
   *
   * El estado se calcula desde una REFERENCIA y no dentro del actualizador
   * de `setElements`: React vuelve a ejecutar los actualizadores en modo
   * estricto y ahí la historia se apilaría dos veces por cambio, dejando
   * "Deshacer" pidiendo dos pulsaciones para un movimiento.
   */
  const cambiar = useCallback(
    (fn: (prev: LayoutElement[]) => LayoutElement[]) => {
      const previo = elementsRef.current;
      const siguiente = fn(previo);
      elementsRef.current = siguiente;
      setElements(siguiente);
      setHistoria((h) => [...h.slice(-29), previo]);
      marcar();
    },
    [marcar],
  );

  /**
   * Un sillón deja de estar "sin acomodar" en cuanto la dirección lo toca:
   * moverlo, girarlo, ligarlo a otra unidad o borrarlo. Es la única señal
   * honesta de que alguien ya lo puso donde va.
   */
  const acomodado = useCallback((resourceId: string | null | undefined) => {
    if (!resourceId) return;
    setPendientes((prev) => (prev.includes(resourceId) ? prev.filter((x) => x !== resourceId) : prev));
  }, []);

  const deshacer = useCallback(() => {
    if (historia.length === 0) return;
    const ultima = historia[historia.length - 1];
    elementsRef.current = ultima;
    setElements(ultima);
    setHistoria((h) => h.slice(0, -1));
    marcar();
  }, [historia, marcar]);

  // ── El lienzo ────────────────────────────────────────────────────────
  const vista = useMemo(() => {
    const minX = -grid.rows * ISO_C - PAD_X;
    const maxX = grid.cols * ISO_C + PAD_X;
    const minY = -PAD_ARRIBA;
    const maxY = ((grid.cols + grid.rows) * ISO_C) / 2 + PAD_ABAJO;
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }, [grid.cols, grid.rows]);

  /** Ratón → celda. Sale de la caja del SVG y del viewBox: el zoom ya va dentro. */
  const aCelda = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const x = vista.minX + ((clientX - r.left) / r.width) * vista.w;
      const y = vista.minY + ((clientY - r.top) / r.height) * vista.h;
      const [col, row] = fromScreen(x, y, 0, 0);
      return { col: Math.round(col), row: Math.round(row) };
    },
    [vista],
  );

  const dentro = useCallback(
    (col: number, row: number) => col >= 0 && row >= 0 && col < grid.cols && row < grid.rows,
    [grid.cols, grid.rows],
  );

  /** ¿Cabe algo en esta celda, sin contar al que se está moviendo? */
  const celdaLibre = useCallback(
    (col: number, row: number, exceptoId: number) =>
      !elements.some((el) => el.id !== exceptoId && el.col === col && el.row === row),
    [elements],
  );

  const onLienzoMove = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      // Solo el fantasma de "poner": el arrastre lo sigue el propio
      // elemento, que tiene el puntero capturado.
      if (moviendo || herramienta.tipo !== "poner") return;
      const celda = aCelda(e.clientX, e.clientY);
      if (celda) setGhost(celda);
    },
    [aCelda, herramienta, moviendo],
  );

  const onLienzoClick = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      // Un arrastre termina en `pointerup` y el navegador manda además un
      // `click` detrás: si no se ignorara, con la herramienta de poner
      // dejaría un mueble suelto en el sitio donde acabas de soltar. La
      // marca se apaga sola (ver `onElementoUp`) y NO al consumirla: si el
      // arrastre acabó fuera del lienzo ese `click` no llega nunca, y una
      // marca que se quedara encendida se comería el clic siguiente.
      if (arrastreRef.current) return;

      if (herramienta.tipo === "poner") {
        const celda = aCelda(e.clientX, e.clientY);
        if (!celda || !dentro(celda.col, celda.row)) return;
        if (elements.length >= EDU_PLANO_MAX_ELEMENTOS) {
          setError(`Este plano ya tiene ${EDU_PLANO_MAX_ELEMENTOS} elementos, que es el máximo.`);
          return;
        }
        const key = herramienta.key;
        cambiar((prev) => {
          const id = prev.reduce((max, el) => Math.max(max, el.id), 0) + 1;
          return [
            ...prev,
            { id, type: key, col: celda.col, row: celda.row, rotation: 0, resourceId: null, name: null },
          ];
        });
        return;
      }

      // Clic en el fondo con la herramienta de mover: deseleccionar.
      // ⚠️ `data-element-id` lo pone la capa compartida (IsoElement) y es
      // el MISMO atributo que usa el editor del dental para lo mismo.
      const target = e.target as Element;
      if (!target.closest("[data-element-id]")) setSelectedId(null);
    },
    [aCelda, cambiar, dentro, elements, herramienta],
  );

  // ── El arrastre ──────────────────────────────────────────────────────
  // 🔴 `setPointerCapture` sobre el ELEMENTO. A partir de ahí, todos los
  // pointermove/pointerup del gesto llegan aquí aunque el dedo se salga del
  // sillón, del lienzo o de la ventana: es lo que hace que arrastrar
  // funcione de verdad, y lo que faltaba cuando esto se seguía con el
  // `mousemove` del SVG y se confirmaba con un `click` que a veces no
  // llegaba nunca.
  const onElementoDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, id: number) => {
      if (herramienta.tipo === "poner") return; // poniendo: el clic pone, no mueve
      if (e.button !== 0 && e.pointerType === "mouse") return; // el botón derecho no arrastra
      e.stopPropagation();
      setSelectedId(id);
      setAviso(null);
      const el = elementsRef.current.find((x) => x.id === id);
      if (!el) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Un navegador que no deje capturar sigue funcionando: los eventos
        // llegan mientras el puntero esté encima del elemento.
      }
      tomar({
        id,
        col: el.col,
        row: el.row,
        desdeCol: el.col,
        desdeRow: el.row,
        pointerId: e.pointerId,
        movido: false,
      });
    },
    [herramienta, tomar],
  );

  const onElementoMove = useCallback(
    (e: ReactPointerEvent<SVGGElement>) => {
      const enMano = moviendoRef.current;
      if (!enMano || e.pointerId !== enMano.pointerId) return;
      const celda = aCelda(e.clientX, e.clientY);
      if (!celda) return;
      if (celda.col === enMano.col && celda.row === enMano.row) return;
      // El dedo tiene que poder arrastrar sin que la página se desplace.
      e.preventDefault();
      tomar({ ...enMano, col: celda.col, row: celda.row, movido: true });
    },
    [aCelda, tomar],
  );

  /** 🔴 AQUÍ se confirma el movimiento. No en un `click` que puede no llegar. */
  const onElementoUp = useCallback(
    (e: ReactPointerEvent<SVGGElement>) => {
      const destino = moviendoRef.current;
      if (!destino || e.pointerId !== destino.pointerId) return;
      e.stopPropagation();
      tomar(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ya se soltó */
      }

      // Clic sin mover = SELECCIONAR. No toca la historia ni ensucia el
      // plano: elegir un elemento no es un cambio.
      if (!destino.movido || (destino.col === destino.desdeCol && destino.row === destino.desdeRow)) {
        return;
      }
      // Se ignora el `click` que viene detrás de este arrastre, y solo ése:
      // el temporizador a cero corre después del click y deja la pizarra
      // limpia aunque el click no haya llegado.
      arrastreRef.current = true;
      window.setTimeout(() => {
        arrastreRef.current = false;
      }, 0);

      if (!dentro(destino.col, destino.row)) {
        setAviso("Ahí ya no hay piso: suéltalo dentro de la rejilla.");
        return;
      }
      if (!celdaLibre(destino.col, destino.row, destino.id)) {
        setAviso("Esa celda ya está ocupada. Suéltalo en una libre.");
        return;
      }

      setAviso(null);
      cambiar((prev) =>
        prev.map((el) =>
          el.id === destino.id ? { ...el, col: destino.col, row: destino.row } : el,
        ),
      );
      const movido = elementsRef.current.find((x) => x.id === destino.id);
      acomodado(movido?.resourceId ?? null);
    },
    [acomodado, cambiar, celdaLibre, dentro, tomar],
  );

  /** El gesto se cancela (Esc del sistema, una llamada entrante): se suelta. */
  const onElementoCancel = useCallback(
    (e: ReactPointerEvent<SVGGElement>) => {
      const enMano = moviendoRef.current;
      if (!enMano || e.pointerId !== enMano.pointerId) return;
      tomar(null);
    },
    [tomar],
  );

  const girar = useCallback(() => {
    if (selectedId === null) return;
    const el = elementsRef.current.find((x) => x.id === selectedId);
    cambiar((prev) =>
      prev.map((x) =>
        x.id === selectedId ? { ...x, rotation: (((x.rotation + 90) % 360) as Rotation) } : x,
      ),
    );
    acomodado(el?.resourceId ?? null);
  }, [acomodado, cambiar, selectedId]);

  const borrar = useCallback(() => {
    if (selectedId === null) return;
    const el = elementsRef.current.find((x) => x.id === selectedId);
    cambiar((prev) => prev.filter((x) => x.id !== selectedId));
    setSelectedId(null);
    acomodado(el?.resourceId ?? null);
    // ⚠️ Un sillón ACTIVO no se quita del piso borrándolo aquí: la lectura
    // del plano lo vuelve a poner (es lo que hace que un sillón nuevo
    // aparezca solo). Decirlo ahora es mejor que dejar que reaparezca
    // "solo" en la próxima carga y que nadie entienda por qué.
    if (el?.resourceId && sillonPorId.has(el.resourceId)) {
      setAviso(
        `«${sillonPorId.get(el.resourceId)?.name}» sigue activo en Sillones, así que volverá al plano. Para quitarlo del piso, dalo de baja allá.`,
      );
    }
  }, [acomodado, cambiar, selectedId, sillonPorId]);

  const ligar = useCallback(
    (id: number, resourceId: string | null) => {
      const chair = chairs.find((c) => c.id === resourceId) ?? null;
      const antes = elementsRef.current.find((x) => x.id === id);
      cambiar((prev) =>
        prev.map((el) =>
          el.id === id ? { ...el, resourceId, name: chair ? chair.name : null } : el,
        ),
      );
      acomodado(antes?.resourceId ?? null);
      acomodado(resourceId);
    },
    [acomodado, cambiar, chairs],
  );

  /** Pone un sillón que falta en el primer hueco libre de la rejilla. */
  const ponerSillon = useCallback(
    (chair: EduPlanoChair) => {
      let nuevoId: number | null = null;
      cambiar((prev) => {
        const ocupadas = new Set(prev.map((el) => `${el.col}:${el.row}`));
        let col = 3;
        let row = 3;
        buscar: for (let r = 3; r < Math.max(4, grid.rows - 3); r += 5) {
          for (let c = 3; c < Math.max(4, grid.cols - 3); c += 4) {
            if (!ocupadas.has(`${c}:${r}`)) {
              col = c;
              row = r;
              break buscar;
            }
          }
        }
        const id = prev.reduce((max, el) => Math.max(max, el.id), 0) + 1;
        nuevoId = id;
        return [
          ...prev,
          {
            id,
            type: EDU_PLANO_TIPO_SILLON,
            col,
            row,
            rotation: 0,
            resourceId: chair.id,
            name: chair.name,
          },
        ];
      });
      // Ponerlo a mano ES acomodarlo: quien pulsa el botón elige el hueco.
      acomodado(chair.id);
      if (nuevoId !== null) setSelectedId(nuevoId);
    },
    [acomodado, cambiar, grid.cols, grid.rows],
  );

  // ── Teclado ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        setHerramienta({ tipo: "mover" });
        setGhost(null);
        tomar(null);
        setSelectedId(null);
        return;
      }
      if (e.key === "r" || e.key === "R") {
        girar();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        borrar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [borrar, girar, tomar]);

  // ── Aviso al salir con algo todavía sin guardar ──────────────────────
  // Con el guardado automático esta ventana dura menos de un segundo, pero
  // no desaparece: cerrar la pestaña justo entre el arrastre y el guardado
  // —o con el guardado en vuelo, o después de un error— seguiría tirando el
  // trabajo sin decir nada.
  useEffect(() => {
    if (!sucio && !guardando) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [guardando, sucio]);

  // ── Guardar ──────────────────────────────────────────────────────────
  /**
   * Manda el plano tal como está AHORA.
   *
   * Apunta qué versión mandó: si mientras viajaba la petición alguien movió
   * otro sillón, el plano NO se da por limpio y el guardado automático
   * vuelve a dispararse con lo nuevo.
   */
  const guardar = useCallback(async () => {
    if (guardandoRef.current) return;
    const mandada = versionRef.current;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      // El endpoint contesta la SEDE entera (`EduPlanoSede`); de ahí solo
      // se leen la fecha y los pendientes: los elementos son los de esta
      // pantalla, y pisarlos con la respuesta borraría lo que la dirección
      // haya movido mientras la petición viajaba.
      const guardado = await eduRequest<{ layout?: EduPlanoLayout }>(
        "/api/instituto/clinica/plano",
        {
          method: "PUT",
          body: {
            campusId: campus.id,
            elements,
            metadata: { gridSize: grid, lastEditAt: new Date().toISOString(), pendientes },
          },
        },
      );
      const devuelto = guardado?.layout ?? null;
      setGuardadoISO(devuelto?.savedAtISO ?? new Date().toISOString());
      // El servidor es quien decide qué sigue sin acomodar: puede haber
      // puesto un sillón que se dio de alta mientras esta pantalla estaba
      // abierta.
      if (devuelto && Array.isArray(devuelto.pendientes)) setPendientes(devuelto.pendientes);
      fallidaRef.current = null;
      setGuardada(mandada);
    } catch (err) {
      // 🔴 El error del servidor se pinta con SUS palabras ("un sillón
      // ligado a una unidad que no es de esta sede"), y la versión que lo
      // provocó se apunta para no reintentarla en bucle. El siguiente
      // cambio —o el botón— lo vuelve a intentar.
      fallidaRef.current = mandada;
      setError(err instanceof Error ? err.message : "No se pudo guardar el plano.");
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }, [campus.id, elements, grid, pendientes]);

  /**
   * EL GUARDADO AUTOMÁTICO.
   *
   * Cada cambio reinicia la cuenta (el efecto se vuelve a montar porque
   * `version` cambió), así que veinte arrastres seguidos son UN guardado.
   * No se reintenta lo que ya falló y no se pisa un guardado en vuelo: al
   * terminar, `guardada` cambia y este efecto vuelve a mirar si quedó algo.
   */
  useEffect(() => {
    if (version === 0 || version === guardada) return;
    if (guardando) return;
    if (fallidaRef.current === version) return;
    const t = setTimeout(() => void guardar(), EDU_PLANO_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [guardar, guardada, guardando, version]);

  // ── Render ───────────────────────────────────────────────────────────
  const ordenados = useMemo(
    () => elements.slice().sort((a, b) => a.col + a.row - (b.col + b.row)),
    [elements],
  );

  const usados = useMemo(() => {
    const m = new Map<string, number>();
    for (const el of elements) {
      if (eduPlanoEsSillon(el.type) && el.resourceId) m.set(el.resourceId, el.id);
    }
    return m;
  }, [elements]);

  /** Los pendientes que además siguen dibujados: los que hay que acomodar. */
  const nuevosSinAcomodar = useMemo(
    () => pendientes.map((id) => sillonPorId.get(id)).filter((c): c is EduPlanoChair => !!c && usados.has(c.id)),
    [pendientes, sillonPorId, usados],
  );

  const fantasma = herramienta.tipo === "poner" ? catalogo.byKey.get(herramienta.key) : undefined;

  return (
    <div className="edu-planoed">
      {/* ── Barra ──────────────────────────────────────────────────── */}
      <FloorBar>
        <Link className="edu-btn edu-btn--ghost edu-btn--sm" href={`/instituto/clinica?sede=${encodeURIComponent(campus.id)}`}>
          <ArrowLeft size={14} aria-hidden="true" /> Volver al plano en vivo
        </Link>

        <span className="edu-planoed__sede">
          {campus.name} <span className="edu-planoed__code">{campus.code}</span>
        </span>

        <span className="edu-planoed__conteo">
          {revision.ligados} de {chairs.length} {chairs.length === 1 ? "sillón ligado" : "sillones ligados"}
          {revision.sinLigar.length > 0 && (
            <b className="edu-planoed__alerta"> · {revision.sinLigar.length} sin ligar</b>
          )}
          {nuevosSinAcomodar.length > 0 && (
            <b className="edu-planoed__nuevo"> · {nuevosSinAcomodar.length} sin acomodar</b>
          )}
        </span>

        <label className="edu-planoed__zoom">
          Zoom
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>

        <div className="edu-planoed__acciones">
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={deshacer}
            disabled={historia.length === 0}
          >
            <Undo2 size={14} aria-hidden="true" /> Deshacer
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => void guardar()}
            disabled={guardando}
          >
            <Save size={14} aria-hidden="true" /> {guardando ? "Guardando…" : "Guardar el plano"}
          </button>
        </div>
      </FloorBar>

      {/* 🔴 El error del servidor, en grande y con sus palabras. Un plano que
          no se guarda tiene que enterarse quien lo está acomodando: la línea
          de estado de abajo se lee de reojo, esto no. */}
      {error && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">No se guardó</p>
            <p className="edu-banner__detail">{error}</p>
            <p className="edu-banner__detail">
              Lo que ves sigue en esta pantalla: arregla lo que dice el aviso y se vuelve a
              guardar solo, o pulsa «Guardar el plano».
            </p>
          </div>
        </div>
      )}

      <p
        className={`edu-planoed__estado${error ? " edu-planoed__estado--mal" : ""}`}
        role="status"
      >
        {error
          ? "Sin guardar."
          : guardando
            ? "Guardando…"
            : sucio
              ? "Guardando en un momento…"
              : guardadoISO
                ? `Guardado ${horaCorta(guardadoISO)}`
                : "Este plano todavía es el automático: en cuanto muevas algo se guarda solo."}
        {aviso && <span className="edu-planoed__aviso"> · {aviso}</span>}
      </p>

      <FloorWorkbench>
        {/* ── Catálogo ────────────────────────────────────────────── */}
        <FloorPanel as="aside" scroll className="edu-planoed__columna">
          <FloorPanelTitle>Elementos</FloorPanelTitle>
          <FloorPanelHelp>
            Elige uno y haz clic en el piso para ponerlo. Para mover algo,{" "}
            <strong>arrástralo</strong>. <kbd>R</kbd> gira, <kbd>Supr</kbd> borra,{" "}
            <kbd>Esc</kbd> suelta. Se guarda solo.
          </FloorPanelHelp>

          {catalogo.grouped.map((grupo) => (
            <FloorPanelGroup key={grupo.id} label={grupo.label}>
              <FloorPalette>
                {grupo.types.map((t) => {
                  const activo = herramienta.tipo === "poner" && herramienta.key === t.key;
                  return (
                    <FloorPaletteItem
                      key={t.key}
                      icon={t.icon}
                      label={t.label}
                      active={activo}
                      onClick={() =>
                        setHerramienta(activo ? { tipo: "mover" } : { tipo: "poner", key: t.key })
                      }
                    />
                  );
                })}
              </FloorPalette>
            </FloorPanelGroup>
          ))}

          <FloorPanelGroup label="Tamaño del piso">
            <div className="edu-planoed__tam">
              <label>
                Ancho
                <input
                  className="edu-input edu-input--sm"
                  type="number"
                  min={EDU_PLANO_GRID_MIN}
                  max={EDU_PLANO_GRID_MAX}
                  value={grid.cols}
                  onChange={(e) => {
                    setGrid((g) => ({ ...g, cols: acotar(Number(e.target.value), g.cols) }));
                    marcar();
                  }}
                />
              </label>
              <label>
                Alto
                <input
                  className="edu-input edu-input--sm"
                  type="number"
                  min={EDU_PLANO_GRID_MIN}
                  max={EDU_PLANO_GRID_MAX}
                  value={grid.rows}
                  onChange={(e) => {
                    setGrid((g) => ({ ...g, rows: acotar(Number(e.target.value), g.rows) }));
                    marcar();
                  }}
                />
              </label>
            </div>
          </FloorPanelGroup>
        </FloorPanel>

        {/* ── Lienzo ──────────────────────────────────────────────── */}
        <FloorCanvasBox className="edu-planoed__lienzo">
          <svg
            ref={svgRef}
            className={`edu-planoed__svg${herramienta.tipo === "poner" ? " edu-planoed__svg--poniendo" : ""}`}
            viewBox={`${vista.minX} ${vista.minY} ${vista.w} ${vista.h}`}
            width={vista.w * zoom}
            height={vista.h * zoom}
            onMouseMove={onLienzoMove}
            onMouseLeave={() => setGhost(null)}
            onClick={onLienzoClick}
          >
            <IsoTiles cols={grid.cols} rows={grid.rows} />

            {ordenados.map((el) => {
              const td = catalogo.byKey.get(el.type);
              if (!td) return null;
              const enMovimiento = moviendo?.id === el.id;
              const col = enMovimiento ? moviendo.col : el.col;
              const row = enMovimiento ? moviendo.row : el.row;
              const esSillon = eduPlanoEsSillon(el.type);
              const suelto = esSillon && !el.resourceId;
              const colgante = esSillon && !!el.resourceId && !chairs.some((c) => c.id === el.resourceId);
              const nuevo = esSillon && !!el.resourceId && pendientes.includes(el.resourceId);
              const [sx, sy] = toScreen(col, row);
              return (
                /* 🔴 El ARRASTRE va en un `<g>` de esta pantalla, no dentro de
                   `IsoElement`: la capa compartida DIBUJA y no interactúa (lo
                   dice su propia cabecera), y el editor del dental arrastra de
                   otra manera. Aquí se envuelve su dibujo con los Pointer
                   Events y la marca del sillón recién puesto, que son de este
                   producto. `data-element-id` lo sigue poniendo ella. */
                <g
                  key={el.id}
                  className={`edu-planoed__arrastre${nuevo ? " edu-planoed__arrastre--nuevo" : ""}`}
                  onPointerDown={(e) => onElementoDown(e, el.id)}
                  onPointerMove={onElementoMove}
                  onPointerUp={onElementoUp}
                  onPointerCancel={onElementoCancel}
                  onLostPointerCapture={onElementoCancel}
                >
                  <IsoElement
                    elementId={el.id}
                    type={td}
                    col={col}
                    row={row}
                    rotation={el.rotation}
                    moving={enMovimiento}
                    selected={el.id === selectedId}
                    label={
                      esSillon
                        ? colgante
                          ? "Sillón que ya no existe"
                          : el.name ?? "Sin ligar"
                        : null
                    }
                    labelBad={suelto || colgante}
                  />
                  {/* 🔴 El sillón que puso el código. Se dibuja y se pinta en
                      vivo desde ya, pero NO está donde está de verdad: la
                      marca se quita en cuanto la dirección lo mueve. */}
                  {nuevo && (
                    <text
                      x={sx + ISO_C / 2}
                      y={sy - 50}
                      textAnchor="middle"
                      className="edu-planoed__nuevomarca"
                    >
                      nuevo · ponlo en su sitio
                    </text>
                  )}
                </g>
              );
            })}

            {fantasma && ghost && dentro(ghost.col, ghost.row) && (
              <IsoGhost type={fantasma} col={ghost.col} row={ghost.row} />
            )}
          </svg>
        </FloorCanvasBox>

        {/* ── Propiedades y sillones ──────────────────────────────── */}
        <FloorPanel as="aside" scroll className="edu-planoed__columna">
          {seleccionado ? (
            <>
              <FloorPanelTitle>
                {catalogo.byKey.get(seleccionado.type)?.label ?? seleccionado.type}
              </FloorPanelTitle>

              {eduPlanoEsSillon(seleccionado.type) && (
                <>
                  <label className="edu-planoed__campo">
                    <span>Unidad de esta sede</span>
                    <select
                      className="edu-input edu-input--sm"
                      value={seleccionado.resourceId ?? ""}
                      onChange={(e) => ligar(seleccionado.id, e.target.value || null)}
                    >
                      <option value="">— sin ligar —</option>
                      {chairs.map((c) => {
                        const ocupadoPor = usados.get(c.id);
                        const libre = ocupadoPor === undefined || ocupadoPor === seleccionado.id;
                        return (
                          <option key={c.id} value={c.id} disabled={!libre}>
                            {c.name}
                            {libre ? "" : " (ya está en el plano)"}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {/* La ayuda va FUERA del <label>: es un párrafo, y un
                      párrafo dentro de una etiqueta no es HTML válido. */}
                  <FloorPanelHelp>
                    Un sillón sin ligar se dibuja, pero <strong>no se pinta en vivo</strong>: el
                    plano no sabe a qué unidad mirar.
                  </FloorPanelHelp>
                </>
              )}

              <div className="edu-planoed__botones">
                <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={girar}>
                  <RotateCw size={14} aria-hidden="true" /> Girar
                </button>
                <button type="button" className="edu-btn edu-btn--danger edu-btn--sm" onClick={borrar}>
                  <Trash2 size={14} aria-hidden="true" /> Borrar
                </button>
              </div>
            </>
          ) : (
            <FloorPanelHelp>
              Haz clic en un elemento del piso para girarlo, borrarlo o ligarlo a su unidad.
            </FloorPanelHelp>
          )}

          {/* ── Los que puso el código y nadie ha acomodado ─────────── */}
          {nuevosSinAcomodar.length > 0 && (
            <FloorPanelGroup divider>
              <FloorPanelTitle>
                {nuevosSinAcomodar.length === 1
                  ? "Un sillón nuevo, sin acomodar"
                  : `${nuevosSinAcomodar.length} sillones nuevos, sin acomodar`}
              </FloorPanelTitle>
              <FloorPanelHelp>
                Se dieron de alta en Sillones después de la última vez que alguien acomodó este
                piso, así que entraron solos <strong>al lado del último</strong> y ya se pintan en
                vivo. Arrástralos a donde están de verdad.
              </FloorPanelHelp>
              <ul className="edu-planoed__lista">
                {nuevosSinAcomodar.map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        const el = elements.find(
                          (x) => eduPlanoEsSillon(x.type) && x.resourceId === c.id,
                        );
                        if (el) setSelectedId(el.id);
                      }}
                    >
                      Verlo
                    </button>
                  </li>
                ))}
              </ul>
            </FloorPanelGroup>
          )}

          <FloorPanelGroup divider>
            <FloorPanelTitle>Sillones de {campus.name}</FloorPanelTitle>
            {chairs.length === 0 ? (
              <FloorPanelHelp>
                Esta sede no tiene unidades activas. Se dan de alta en Sillones.
              </FloorPanelHelp>
            ) : revision.sinDibujar.length === 0 ? (
              <FloorPanelHelp>Están los {chairs.length} en el plano.</FloorPanelHelp>
            ) : (
              <ul className="edu-planoed__lista">
                {revision.sinDibujar.map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => ponerSillon(c)}
                    >
                      Ponerlo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FloorPanelGroup>
        </FloorPanel>
      </FloorWorkbench>
    </div>
  );
}

/** Acota el tamaño del piso al rango que el mundo 3D sabe dibujar. */
function acotar(valor: number, anterior: number): number {
  if (!Number.isFinite(valor)) return anterior;
  return Math.min(EDU_PLANO_GRID_MAX, Math.max(EDU_PLANO_GRID_MIN, Math.round(valor)));
}

/**
 * "12:41" para lo guardado hoy; con la fecha delante si fue otro día.
 *
 * La línea de estado se lee de reojo mientras se arrastra un sillón: la
 * hora sola contesta "¿ya se guardó lo que acabo de hacer?" sin obligar a
 * leer una fecha completa que casi siempre es la de hoy.
 */
function horaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hora = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const hoy = new Date();
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  return mismoDia ? hora : `${d.toLocaleDateString("es-MX", { dateStyle: "short" })} ${hora}`;
}

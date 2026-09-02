"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import { C as ISO_C, fromScreen, toScreen } from "@/lib/floor-plan/iso";
import type { LayoutElement, Rotation } from "@/lib/floor-plan/element-types";
import {
  EDU_PLANO_GRID_MAX,
  EDU_PLANO_GRID_MIN,
  EDU_PLANO_MAX_ELEMENTOS,
  EDU_PLANO_TIPO_SILLON,
  eduPlanoEsSillon,
  eduPlanoRevision,
  type EduPlanoChair,
  type EduPlanoLayout,
} from "@/lib/edu/plano-core";

/**
 * /instituto/clinica/plano — ACOMODAR EL PISO (solo DIRECCIÓN).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL CATÁLOGO Y LA MATEMÁTICA SON DEL DENTAL; LA PANTALLA, NO
 *
 * Se IMPORTAN `getCatalogForClinic` (el catálogo isométrico: paredes,
 * sillón, gabinete, mostrador, baño, mobiliario) y `toScreen`/`fromScreen`
 * de src/lib/floor-plan/. Son funciones puras que devuelven cadenas SVG y
 * pares de coordenadas: el mismo dibujo que pinta el editor del dental y el
 * mismo que después lee el mundo 3D.
 *
 * ⛔ Lo que NO se importa es su PANTALLA
 * (src/app/dashboard/clinic-layout/layout-client.tsx, 1 538 renglones):
 * está atada a sus rutas (`/api/clinic-layout`), a sus Resources, a su
 * modo En Vivo, a su optimizador y a su i18n. Aquí hace falta otra cosa —
 * ligar cada sillón a un `EduChair` de ESTA sede— y eso es un editor
 * propio de trescientos renglones, no un fork de mil quinientos.
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
  const [moviendo, setMoviendo] = useState<{ id: number; col: number; row: number } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoISO, setGuardadoISO] = useState<string | null>(layout.savedAtISO);
  const [sucio, setSucio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const revision = useMemo(() => eduPlanoRevision(elements, chairs), [elements, chairs]);
  const seleccionado = useMemo(
    () => elements.find((e) => e.id === selectedId) ?? null,
    [elements, selectedId],
  );

  /** Cambiar los elementos SIEMPRE por aquí: apila la historia y ensucia. */
  const cambiar = useCallback(
    (fn: (prev: LayoutElement[]) => LayoutElement[]) => {
      setElements((prev) => {
        setHistoria((h) => [...h.slice(-29), prev]);
        setSucio(true);
        setError(null);
        return fn(prev);
      });
    },
    [],
  );

  const deshacer = useCallback(() => {
    setHistoria((h) => {
      if (h.length === 0) return h;
      const ultima = h[h.length - 1];
      setElements(ultima);
      setSucio(true);
      return h.slice(0, -1);
    });
  }, []);

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

  const onLienzoMove = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      const celda = aCelda(e.clientX, e.clientY);
      if (!celda) return;
      if (moviendo) {
        setMoviendo({ id: moviendo.id, col: celda.col, row: celda.row });
        return;
      }
      if (herramienta.tipo === "poner") setGhost(celda);
    },
    [aCelda, herramienta, moviendo],
  );

  const onLienzoClick = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      // Soltar un elemento que se estaba moviendo.
      if (moviendo) {
        const destino = moviendo;
        setMoviendo(null);
        if (!dentro(destino.col, destino.row)) return;
        // Un clic para SELECCIONAR también pasa por aquí (el mousedown ya
        // dejó el elemento "en la mano"). Sin esta comprobación, elegir un
        // elemento apilaría un paso de historia y dejaría la pantalla
        // diciendo "tienes cambios sin guardar" sin haber movido nada.
        const antes = elements.find((x) => x.id === destino.id);
        if (!antes || (antes.col === destino.col && antes.row === destino.row)) return;
        cambiar((prev) =>
          prev.map((el) =>
            el.id === destino.id ? { ...el, col: destino.col, row: destino.row } : el,
          ),
        );
        return;
      }

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
      const target = e.target as Element;
      if (!target.closest("[data-el]")) setSelectedId(null);
    },
    [aCelda, cambiar, dentro, elements, herramienta, moviendo],
  );

  const onElementoDown = useCallback(
    (e: ReactMouseEvent, id: number) => {
      if (herramienta.tipo === "poner") return; // poniendo: el clic pone, no mueve
      e.stopPropagation();
      setSelectedId(id);
      const el = elements.find((x) => x.id === id);
      if (el) setMoviendo({ id, col: el.col, row: el.row });
    },
    [elements, herramienta],
  );

  const girar = useCallback(() => {
    if (selectedId === null) return;
    cambiar((prev) =>
      prev.map((el) =>
        el.id === selectedId ? { ...el, rotation: (((el.rotation + 90) % 360) as Rotation) } : el,
      ),
    );
  }, [cambiar, selectedId]);

  const borrar = useCallback(() => {
    if (selectedId === null) return;
    cambiar((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }, [cambiar, selectedId]);

  const ligar = useCallback(
    (id: number, resourceId: string | null) => {
      const chair = chairs.find((c) => c.id === resourceId) ?? null;
      cambiar((prev) =>
        prev.map((el) =>
          el.id === id ? { ...el, resourceId, name: chair ? chair.name : null } : el,
        ),
      );
    },
    [cambiar, chairs],
  );

  /** Pone un sillón que falta en el primer hueco libre de la rejilla. */
  const ponerSillon = useCallback(
    (chair: EduPlanoChair) => {
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
    },
    [cambiar, grid.cols, grid.rows],
  );

  // ── Teclado ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        setHerramienta({ tipo: "mover" });
        setGhost(null);
        setMoviendo(null);
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
  }, [borrar, girar]);

  // ── Aviso al salir con cambios sin guardar ───────────────────────────
  useEffect(() => {
    if (!sucio) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [sucio]);

  // ── Guardar ──────────────────────────────────────────────────────────
  const guardar = useCallback(async () => {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const guardado = await eduRequest<{ layout: EduPlanoLayout }>(
        "/api/instituto/clinica/plano",
        {
          method: "PUT",
          body: {
            campusId: campus.id,
            elements,
            metadata: { gridSize: grid, lastEditAt: new Date().toISOString() },
          },
        },
      );
      setGuardadoISO(guardado?.layout?.savedAtISO ?? new Date().toISOString());
      setSucio(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el plano.");
    } finally {
      setGuardando(false);
    }
  }, [campus.id, elements, grid, guardando]);

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

  const celdas: ReactElement[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const A = toScreen(c, r);
      const B = toScreen(c + 1, r);
      const D = toScreen(c + 1, r + 1);
      const E = toScreen(c, r + 1);
      celdas.push(
        <polygon
          key={`t${c}-${r}`}
          className={`edu-planoed__tile edu-planoed__tile--${(c + r) % 2 === 0 ? "a" : "b"}`}
          points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${D[0]},${D[1]} ${E[0]},${E[1]}`}
        />,
      );
    }
  }

  return (
    <div className="edu-planoed">
      {/* ── Barra ──────────────────────────────────────────────────── */}
      <div className="edu-planoed__bar">
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
      </div>

      {error && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">No se guardó</p>
            <p className="edu-banner__detail">{error}</p>
          </div>
        </div>
      )}

      <p className="edu-planoed__estado" role="status">
        {sucio
          ? "Tienes cambios sin guardar."
          : guardadoISO
            ? `Guardado · ${new Date(guardadoISO).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`
            : "Este plano todavía es el automático: guárdalo para hacerlo tuyo."}
      </p>

      <div className="edu-planoed__cuerpo">
        {/* ── Catálogo ────────────────────────────────────────────── */}
        <aside className="edu-planoed__catalogo">
          <p className="edu-planoed__ctitulo">Elementos</p>
          <p className="edu-planoed__cayuda">
            Elige uno y haz clic en el piso para ponerlo. <kbd>R</kbd> gira,{" "}
            <kbd>Supr</kbd> borra, <kbd>Esc</kbd> suelta.
          </p>

          {catalogo.grouped.map((grupo) => (
            <div className="edu-planoed__grupo" key={grupo.id}>
              <p className="edu-planoed__glabel">{grupo.label}</p>
              <div className="edu-planoed__gitems">
                {grupo.types.map((t) => {
                  const activo = herramienta.tipo === "poner" && herramienta.key === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className={`edu-planoed__item${activo ? " edu-planoed__item--on" : ""}`}
                      onClick={() =>
                        setHerramienta(activo ? { tipo: "mover" } : { tipo: "poner", key: t.key })
                      }
                      title={t.label}
                    >
                      {/* ⚠️ `icon` del catálogo es un FRAGMENTO de SVG (rects
                          y paths sueltos), no un `<svg>` completo: hay que
                          envolverlo con su viewBox 40×40 o el navegador no
                          pinta nada. Es exactamente lo que hace el editor
                          del dental con estas mismas cadenas. */}
                      <svg
                        className="edu-planoed__icono"
                        viewBox="0 0 40 40"
                        width={34}
                        height={34}
                        aria-hidden="true"
                      >
                        <g dangerouslySetInnerHTML={{ __html: t.icon }} />
                      </svg>
                      <span className="edu-planoed__ilabel">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="edu-planoed__grupo">
            <p className="edu-planoed__glabel">Tamaño del piso</p>
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
                    setSucio(true);
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
                    setSucio(true);
                  }}
                />
              </label>
            </div>
          </div>
        </aside>

        {/* ── Lienzo ──────────────────────────────────────────────── */}
        <div className="edu-planoed__lienzo">
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
            <g>{celdas}</g>

            {ordenados.map((el) => {
              const td = catalogo.byKey.get(el.type);
              if (!td) return null;
              const enMovimiento = moviendo?.id === el.id;
              const col = enMovimiento ? moviendo.col : el.col;
              const row = enMovimiento ? moviendo.row : el.row;
              const [sx, sy] = toScreen(col, row);
              const esSillon = eduPlanoEsSillon(el.type);
              const suelto = esSillon && !el.resourceId;
              const colgante = esSillon && !!el.resourceId && !chairs.some((c) => c.id === el.resourceId);
              const etiqueta = esSillon ? el.name ?? "Sin ligar" : null;
              return (
                <g
                  key={el.id}
                  data-el={el.id}
                  className={`edu-planoed__el${enMovimiento ? " edu-planoed__el--mov" : ""}`}
                  onMouseDown={(e) => onElementoDown(e, el.id)}
                >
                  {/* ⚠️ La rotación envuelve SOLO al dibujo. El editor del
                      dental gira el grupo entero y con él la etiqueta, que a
                      90° se lee de lado; aquí el nombre del sillón y la marca
                      de selección se quedan derechos. */}
                  <g
                    transform={el.rotation !== 0 ? `rotate(${el.rotation} ${sx} ${sy})` : undefined}
                    dangerouslySetInnerHTML={{ __html: td.draw(sx, sy, {}) }}
                  />
                  {etiqueta && (
                    <text
                      x={sx + ISO_C / 2}
                      y={sy - 66}
                      textAnchor="middle"
                      className={`edu-planoed__etiqueta${suelto || colgante ? " edu-planoed__etiqueta--mala" : ""}`}
                    >
                      {colgante ? "Sillón que ya no existe" : etiqueta}
                    </text>
                  )}
                  {el.id === selectedId && (
                    <circle cx={sx} cy={sy} r={10} className="edu-planoed__sel" />
                  )}
                </g>
              );
            })}

            {herramienta.tipo === "poner" && ghost && dentro(ghost.col, ghost.row) && (
              <g
                className="edu-planoed__ghost"
                dangerouslySetInnerHTML={{
                  __html:
                    catalogo.byKey.get(herramienta.key)?.draw(...toScreen(ghost.col, ghost.row), {}) ??
                    "",
                }}
              />
            )}
          </svg>
        </div>

        {/* ── Propiedades y sillones ──────────────────────────────── */}
        <aside className="edu-planoed__props">
          {seleccionado ? (
            <>
              <p className="edu-planoed__ctitulo">
                {catalogo.byKey.get(seleccionado.type)?.label ?? seleccionado.type}
              </p>

              {eduPlanoEsSillon(seleccionado.type) && (
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
                  <span className="edu-planoed__ayuda">
                    Un sillón sin ligar se dibuja, pero <strong>no se pinta en vivo</strong>: el
                    plano no sabe a qué unidad mirar.
                  </span>
                </label>
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
            <p className="edu-planoed__ayuda">
              Haz clic en un elemento del piso para girarlo, borrarlo o ligarlo a su unidad.
            </p>
          )}

          <div className="edu-planoed__faltan">
            <p className="edu-planoed__ctitulo">Sillones de {campus.name}</p>
            {chairs.length === 0 ? (
              <p className="edu-planoed__ayuda">
                Esta sede no tiene unidades activas. Se dan de alta en Sillones.
              </p>
            ) : revision.sinDibujar.length === 0 ? (
              <p className="edu-planoed__ayuda">Están los {chairs.length} en el plano. </p>
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
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Acota el tamaño del piso al rango que el mundo 3D sabe dibujar. */
function acotar(valor: number, anterior: number): number {
  if (!Number.isFinite(valor)) return anterior;
  return Math.min(EDU_PLANO_GRID_MAX, Math.max(EDU_PLANO_GRID_MIN, Math.round(valor)));
}

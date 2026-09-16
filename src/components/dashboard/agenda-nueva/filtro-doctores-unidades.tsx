"use client";

/**
 * El filtro de la barra: UN solo desplegable con doctores y unidades dentales.
 *
 * El diseño lo quiere así, y tiene razón: recepción piensa en «quién y dónde»
 * como una sola pregunta. Filtra las tres vistas a la vez, porque el estado
 * vive en `useAgendaNueva()` y no en este componente.
 *
 * El filtrado es EN CLIENTE, sobre las citas que ya están cargadas, y no toca
 * `state.filters` del provider a propósito: ese dispara un refetch al servidor
 * por cada casilla que marcas, y el desplegable está pensado para marcarse y
 * desmarcarse a golpes. Las citas del día ya están todas en memoria; esconder
 * una columna no necesita ir a la base.
 */

import { useEffect, useRef, useState } from "react";
import { Armchair, Check, ChevronDown, ChevronUp, ListFilter } from "lucide-react";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import s from "./agenda-nueva.module.css";

export function FiltroDoctoresUnidades() {
  const ag = useAgendaNueva();
  const [abierto, setAbierto] = useState(false);
  const cajaRef = useRef<HTMLDivElement | null>(null);

  // Escape cierra. El clic fuera lo cierra la capa de abajo, que además evita
  // que el clic se cuele a la cita que hubiera detrás.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  const etiqueta = etiquetaDelFiltro(ag);

  return (
    <>
      {abierto && <div className={s.capaCierre} onClick={() => setAbierto(false)} aria-hidden />}
      <div className={s.filtroCaja} ref={cajaRef}>
        <button
          type="button"
          className={`${s.filtroBoton} ${ag.todoMarcado ? "" : s.filtroBotonActivo}`}
          aria-expanded={abierto}
          aria-haspopup="true"
          onClick={() => setAbierto((v) => !v)}
        >
          <span className={s.filtroIcono}>
            <IconoFiltro />
          </span>
          <span className={s.filtroEtiqueta}>{etiqueta}</span>
          {ag.desmarcados > 0 && <span className={s.filtroContador}>{ag.desmarcados}</span>}
          <span className={s.filtroIcono}>
            <ChevronFiltro abierto={abierto} />
          </span>
        </button>

        {abierto && (
          <div className={s.filtroMenu} role="group" aria-label="Doctores y unidades">
            <div className={s.filtroSeccion}>
              <span className={s.rotuloSeccion}>Doctores</span>
              <button type="button" className={s.filtroVerTodos} onClick={ag.marcarTodo}>
                Ver todos
              </button>
            </div>

            {ag.responsablesTodos.length === 0 && (
              <div className={s.filtroVacio}>No hay doctores activos en la agenda.</div>
            )}

            {ag.responsablesTodos.map((r) => {
              const marcado = ag.docsVisibles.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={s.filtroFila}
                  aria-pressed={marcado}
                  onClick={() => ag.alternarDoctor(r.id)}
                >
                  <Casilla marcada={marcado} />
                  <span className={s.cuadritoColor} style={{ background: r.color }} />
                  <span className={s.filtroNombre}>{r.nombre}</span>
                </button>
              );
            })}

            {ag.unidadesTodas.length > 0 && (
              <>
                <div className={s.filtroSeparador} />
                <div className={s.filtroSeccion}>
                  <span className={s.rotuloSeccion}>Unidades dentales</span>
                </div>
                {ag.unidadesTodas.map((u) => {
                  const marcada = ag.unidadesVisibles.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className={s.filtroFila}
                      aria-pressed={marcada}
                      onClick={() => ag.alternarUnidad(u.id)}
                    >
                      <Casilla marcada={marcada} />
                      <span className={s.filtroIcono}>
                        <Armchair size={18} strokeWidth={2} />
                      </span>
                      <span className={s.filtroNombre}>{u.name}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Casilla({ marcada }: { marcada: boolean }) {
  return (
    <span className={`${s.casilla} ${marcada ? s.casillaMarcada : ""}`} aria-hidden>
      {marcada && <Check size={14} strokeWidth={3} />}
    </span>
  );
}

/**
 * La etiqueta del botón.
 *
 * El diseño enseña «Todos los doctores y unidades» y, con filtro, algo como
 * «Dra. Díaz · 2 unidades». Se respeta, con una salvedad: si la clínica no
 * usa unidades, la parte de unidades desaparece en vez de decir «0 unidades».
 */
function etiquetaDelFiltro(ag: ReturnType<typeof useAgendaNueva>): string {
  const hayUnidades = ag.unidadesTodas.length > 0;
  if (ag.todoMarcado) {
    return hayUnidades ? "Todos los doctores y unidades" : "Todos los doctores";
  }

  const nDocs = ag.docsVisibles.size;
  const nUnidades = ag.unidadesVisibles.size;

  const parteDocs =
    nDocs === 0
      ? "Ningún doctor"
      : nDocs === 1
        ? (ag.responsablesVisibles[0]?.nombreCorto ?? "1 doctor")
        : `${nDocs} doctores`;

  if (!hayUnidades || nUnidades === ag.unidadesTodas.length) return parteDocs;

  const parteUnidades =
    nUnidades === 0 ? "ninguna unidad" : nUnidades === 1 ? "1 unidad" : `${nUnidades} unidades`;

  return `${parteDocs} · ${parteUnidades}`;
}

/** El chevron del desplegable. */
function ChevronFiltro({ abierto }: { abierto: boolean }) {
  return abierto ? <ChevronUp size={18} strokeWidth={2} /> : <ChevronDown size={18} strokeWidth={2} />;
}

/** El ícono del propio filtro. */
function IconoFiltro() {
  return <ListFilter size={18} strokeWidth={2} />;
}

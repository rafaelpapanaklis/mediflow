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
import { Armchair, Check, ListFilter } from "lucide-react";
import { textoDelFiltro } from "@/lib/agenda-nueva/filtro-etiqueta";
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

  // Sin filtro, el botón es SOLO el ícono (Rafael: «borra la letra y solo
  // deja el icono de filtrar»). Con filtro, enseña la selección. El nombre
  // completo va siempre en `title` y `aria-label`: ver `filtro-etiqueta.ts`.
  const texto = textoDelFiltro({
    hayUnidades: ag.unidadesTodas.length > 0,
    todoMarcado: ag.todoMarcado,
    nDocs: ag.docsVisibles.size,
    nombreUnico: ag.docsVisibles.size === 1 ? ag.responsablesVisibles[0]?.nombreCorto : null,
    nUnidades: ag.unidadesVisibles.size,
    nUnidadesTotal: ag.unidadesTodas.length,
  });

  return (
    <>
      {abierto && <div className={s.capaCierre} onClick={() => setAbierto(false)} aria-hidden />}
      <div className={s.filtroCaja} ref={cajaRef}>
        <button
          type="button"
          className={[
            s.filtroBoton,
            ag.todoMarcado ? s.filtroBotonSoloIcono : s.filtroBotonActivo,
            abierto ? s.filtroBotonAbierto : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-expanded={abierto}
          aria-haspopup="true"
          aria-label={texto.accesible}
          title={texto.accesible}
          onClick={() => setAbierto((v) => !v)}
        >
          <span className={s.filtroIcono}>
            <IconoFiltro />
          </span>
          {/* En pantallas estrechas la selección se esconde (CSS) y queda el
              ícono morado con el contador: el nombre accesible no se pierde. */}
          {texto.visible !== null && <span className={s.filtroEtiqueta}>{texto.visible}</span>}
          {ag.desmarcados > 0 && <span className={s.filtroContador}>{ag.desmarcados}</span>}
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

/** El ícono del propio filtro. */
function IconoFiltro() {
  return <ListFilter size={18} strokeWidth={2} />;
}

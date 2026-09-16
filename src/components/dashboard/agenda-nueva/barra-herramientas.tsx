"use client";

/**
 * La barra de herramientas de la agenda nueva (64 px) — COMÚN a Día, Semana y
 * Mes. La hace ws1-t1; ws1-t2 no la toca.
 *
 * Lleva, en este orden: el control Día/Semana/Mes, la navegación de fecha, el
 * título del periodo, el espaciador, «N por validar» (solo si hay), el filtro
 * de doctores y unidades, y el botón «Buscar hueco».
 *
 * La fecha NO vive aquí: se navega con `setDay` del provider de siempre, que
 * cambia el `?date=` de la URL. Así un enlace a un día concreto sigue
 * funcionando y el botón «atrás» del navegador hace lo que se espera.
 */

import { ChevronLeft, ChevronRight, Search, ShieldAlert } from "lucide-react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { todayInTz } from "@/lib/agenda/time-utils";
import { esHoy, moverPeriodo, tituloDePeriodo } from "@/lib/agenda-nueva/fechas";
import { esSinConfirmar } from "@/lib/agenda-nueva/estados";
import { useAgendaNueva, type VistaAgenda } from "./contexto-agenda-nueva";
import { FiltroDoctoresUnidades } from "./filtro-doctores-unidades";
import s from "./agenda-nueva.module.css";

const VISTAS: { clave: VistaAgenda; etiqueta: string }[] = [
  { clave: "dia", etiqueta: "Día" },
  { clave: "semana", etiqueta: "Semana" },
  { clave: "mes", etiqueta: "Mes" },
];

export function BarraHerramientas() {
  const { state, setDay, togglePendingPanel } = useAgenda();
  const ag = useAgendaNueva();

  const hoy = esHoy(state.dayISO, state.timezone);
  const titulo = tituloDePeriodo(ag.vista, state.dayISO);

  // La misma cuenta que la sub-barra de la agenda de siempre: las que manda el
  // servidor o las del rango cargado, la mayor.
  const porValidar = Math.max(
    state.pendingValidation.length,
    state.appointments.filter((a) => a.requiresValidation && esSinConfirmar(a.status)).length,
  );

  return (
    <div className={s.barra}>
      {/* ── Día / Semana / Mes ── */}
      <div className={s.segmentado} role="tablist" aria-label="Vista de la agenda">
        {VISTAS.map((v) => (
          <button
            key={v.clave}
            type="button"
            role="tab"
            aria-selected={ag.vista === v.clave}
            className={`${s.segmento} ${ag.vista === v.clave ? s.segmentoActivo : ""}`}
            onClick={() => ag.irAVista(v.clave)}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>

      {/* ── Navegación de fecha ── */}
      <div className={s.navFecha}>
        <button
          type="button"
          className={s.navBoton}
          aria-label="Periodo anterior"
          onClick={() => setDay(moverPeriodo(ag.vista, state.dayISO, -1))}
        >
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={s.navHoy}
          onClick={() => setDay(todayInTz(state.timezone))}
        >
          Hoy
        </button>
        <button
          type="button"
          className={s.navBoton}
          aria-label="Periodo siguiente"
          onClick={() => setDay(moverPeriodo(ag.vista, state.dayISO, 1))}
        >
          <ChevronRight size={20} strokeWidth={2} />
        </button>
      </div>

      {/* ── Título del periodo ── */}
      <div className={s.titulo}>
        <h1 className={s.tituloTexto}>{titulo}</h1>
        {/* El chip «Hoy» es del diseño solo para la vista Día. */}
        {ag.vista === "dia" && hoy && <span className={s.chipHoy}>Hoy</span>}
      </div>

      <div className={s.espaciador} />

      {/* ── Por validar ── abre la cola de la agenda de siempre, arriba. */}
      {porValidar > 0 && (
        <button
          type="button"
          className={`${s.botonValidar} ${state.pendingSectionOpen ? s.botonValidarAbierto : ""}`}
          aria-expanded={state.pendingSectionOpen}
          onClick={() => togglePendingPanel()}
        >
          <ShieldAlert size={18} strokeWidth={2.2} />
          {porValidar} por validar
        </button>
      )}

      <FiltroDoctoresUnidades />

      {/* ── Buscar hueco ── */}
      <button
        type="button"
        className={`${s.botonHuecos} ${ag.panel === "huecos" ? s.botonHuecosAbierto : ""}`}
        aria-expanded={ag.panel === "huecos"}
        onClick={ag.alternarHuecos}
      >
        <Search size={18} strokeWidth={2.2} />
        Buscar hueco
      </button>
    </div>
  );
}

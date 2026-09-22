"use client";

/**
 * La barra de herramientas de la agenda nueva (64 px) — COMÚN a Día, Semana y
 * Mes. La hace ws1-t1; ws1-t2 no la toca.
 *
 * Lleva, en este orden: el control Día/Semana/Mes, la navegación de fecha, el
 * título del periodo, el espaciador, «N por validar» (solo si hay), el filtro
 * de doctores y unidades, el botón «Buscar espacio» y el botón «Nueva cita».
 *
 * La fecha NO vive aquí: se navega con `setDay` del provider de siempre, que
 * cambia el `?date=` de la URL. Así un enlace a un día concreto sigue
 * funcionando y el botón «atrás» del navegador hace lo que se espera.
 */

import { useMemo } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Search, ShieldAlert } from "lucide-react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { todayInTz } from "@/lib/agenda/time-utils";
import { esHoy, moverPeriodo, tituloDePeriodo } from "@/lib/agenda-nueva/fechas";
import { esSinConfirmar } from "@/lib/agenda-nueva/estados";
import { useT } from "@/i18n/i18n-provider";
import { useBloqueosAgenda } from "@/components/dashboard/bloqueos/usar-bloqueos-agenda";
import { bandasDelDia, type BandaBloqueo } from "@/components/dashboard/bloqueos/fechas";
import { useAgendaNueva, type VistaAgenda } from "./contexto-agenda-nueva";
import { FiltroDoctoresUnidades } from "./filtro-doctores-unidades";
import s from "./agenda-nueva.module.css";

const VISTAS: { clave: VistaAgenda; etiqueta: string }[] = [
  { clave: "dia", etiqueta: "Día" },
  { clave: "semana", etiqueta: "Semana" },
  { clave: "mes", etiqueta: "Mes" },
];

export function BarraHerramientas() {
  const { state, setDay, togglePendingPanel, permissions } = useAgenda();
  const ag = useAgendaNueva();
  const { open: abrirNuevaCita } = useNewAppointmentDialog();
  const t = useT();

  const hoy = esHoy(state.dayISO, state.timezone);
  const titulo = tituloDePeriodo(ag.vista, state.dayISO);

  // ═══════════════════════════════════════════════════════════════════════
  // EL DÍA BLOQUEADO SE TIENE QUE VER (WS1-T3)
  //
  // 🔴 SOLO EN LA VISTA DÍA. El título de Semana es un rango («31 ago – 6
  // sep») y el de Mes un mes entero: colgarles el motivo de UN día sería
  // decir que la semana entera está cerrada. En esas dos vistas el aviso va
  // donde corresponde —la columna del día y la celda del día—, no en el
  // título.
  //
  // 🔴 Y ESTO NO ES EL «CERRADO» DEL HORARIO SEMANAL. Un domingo que la
  // clínica no abre sigue diciendo «Cerrado» en gris, como hoy, y no se pinta
  // de amarillo: eso es la jornada normal. El amarillo es para la EXCEPCIÓN
  // —un festivo, una obra, unas vacaciones— que alguien escribió a mano y que
  // lleva un motivo. Mezclarlas quitaría todo el valor al aviso: si el
  // domingo también sale amarillo, el amarillo deja de significar nada.
  // ═══════════════════════════════════════════════════════════════════════
  const bloqueos = useBloqueosAgenda();
  const avisoBloqueo = useMemo(() => {
    if (ag.vista !== "dia" || bloqueos.length === 0) return null;
    const bandas = bandasDelDia(bloqueos, state.dayISO, state.timezone, null);
    if (bandas.length === 0) return null;
    // Si hay VARIOS, uno solo manda y el resto se resume: apilar tres avisos
    // sobre el título deja la barra ilegible justo el día que más importa.
    // Manda el de toda la clínica si lo hay —cierra a todo el mundo, es la
    // noticia más grande—; si no, el que empieza antes, que es el que una
    // persona nombraría.
    const principal: BandaBloqueo =
      bandas.find((b) => b.doctorId === null) ?? bandas[0];
    return { principal, otros: bandas.length - 1 };
  }, [ag.vista, bloqueos, state.dayISO, state.timezone]);

  // El texto que se LEE. El motivo que escribió la persona, nunca la etiqueta
  // del tipo; y si el bloqueo es de un doctor, su nombre delante — «Dra. Ruiz
  // — Congreso» dice que los demás siguen atendiendo.
  const textoBloqueo = avisoBloqueo
    ? avisoBloqueo.principal.doctorId === null
      ? avisoBloqueo.principal.reason
      : t("agenda.bloqueos.aviso.etiquetaDoctor", {
          doctor:
            avisoBloqueo.principal.doctorNombre ??
            t("agenda.bloqueos.confirmar.alcanceDoctorSinNombre"),
          motivo: avisoBloqueo.principal.reason,
        })
    : null;

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

      {/* ── Título del periodo ──
          Con un bloqueo encima, el propio título se convierte en el aviso:
          fondo amarillo, triángulo y el motivo escrito al lado. No es una
          fila nueva a propósito — la barra mide 64 px y a 390 px una segunda
          fila empujaría la rejilla fuera de la pantalla. */}
      <div
        className={[
          s.titulo,
          avisoBloqueo
            ? avisoBloqueo.principal.doctorId === null
              ? s.tituloBloqueado
              : s.tituloBloqueadoDoctor
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* El icono va ANTES del texto y no es decorativo: junto al motivo
            escrito, el aviso se entiende sin ver un solo color. */}
        {avisoBloqueo && (
          <AlertTriangle
            size={17}
            strokeWidth={2.3}
            className={s.tituloBloqueoIcono}
            aria-hidden
          />
        )}
        <h1 className={s.tituloTexto}>{titulo}</h1>
        {avisoBloqueo && textoBloqueo && (
          <>
            <span className={s.tituloBloqueoSep} aria-hidden>
              ·
            </span>
            <span
              className={s.tituloBloqueoMotivo}
              // El motivo puede medir 200 caracteres y en la barra se recorta
              // con puntos suspensivos: el completo queda al pasar el ratón.
              title={textoBloqueo}
            >
              {textoBloqueo}
            </span>
            {avisoBloqueo.otros > 0 && (
              <span className={s.tituloBloqueoMas}>
                {t("agenda.bloqueos.aviso.yMas", { count: avisoBloqueo.otros })}
              </span>
            )}
            {/* Para lector de pantalla: el aviso completo, sin depender del
                recorte visual ni del color. */}
            <span className={s.soloLectores} role="status">
              {t("agenda.bloqueos.aviso.aria", { detalle: textoBloqueo })}
            </span>
          </>
        )}
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

      {/* ── Buscar espacio ── */}
      <button
        type="button"
        className={`${s.botonHuecos} ${ag.panel === "huecos" ? s.botonHuecosAbierto : ""}`}
        aria-expanded={ag.panel === "huecos"}
        aria-label="Buscar espacio"
        onClick={ag.alternarHuecos}
      >
        <Search size={18} strokeWidth={2.2} />
        <span className={s.etiquetaBoton}>Buscar espacio</span>
      </button>

      {/* ── Nueva cita ── La MISMA ventana y la MISMA llamada que el botón de
          la agenda de siempre (`AgendaTopbar`): sin fecha ni doctor puestos,
          y solo para quien puede crear citas. */}
      {permissions.canCreate && (
        <button
          type="button"
          className={s.botonNuevaCita}
          onClick={() => abrirNuevaCita({})}
          aria-label="Nueva cita"
        >
          <Plus size={18} strokeWidth={2.4} />
          <span className={s.etiquetaBoton}>Nueva cita</span>
        </button>
      )}
    </div>
  );
}

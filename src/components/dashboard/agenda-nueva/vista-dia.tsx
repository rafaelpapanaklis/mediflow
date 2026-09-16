"use client";

/**
 * La vista Día — la principal, la que se usa el 90 % del tiempo.
 *
 * Una columna por responsable, la cuadrícula de `Cuadricula`, y las tarjetas
 * colocadas con aritmética sobre los 112 px por hora.
 *
 * Las tres cosas que había que decidir, y lo que se decidió:
 *
 *  1. **La línea de «ahora»** solo se pinta si el día que se mira es hoy EN LA
 *     ZONA DE LA CLÍNICA, y se recalcula cada minuto (`useMinuto`). Con el
 *     proceso en UTC —lo normal en Vercel— compararlo con el reloj del
 *     servidor la pintaría en el sitio equivocado o en el día equivocado.
 *
 *  2. **Los nueve estados** salen de `PINTA_POR_ESTADO`, exhaustivo por tipo.
 *     Aquí no hay ni un `if (status === …)`.
 *
 *  3. **Las citas que se solapan** se reparten en carriles con `assignLanes`,
 *     el mismo algoritmo que ya usa la agenda de siempre — no uno nuevo. Dos
 *     citas a la misma hora salen una al lado de la otra, a mitad de ancho,
 *     y ninguna tapa a la otra. Con el ancho partido, la tarjeta esconde el
 *     horario y la segunda línea (no caben) y los deja en el `title`.
 *     ⚠️ `assignLanes` DESCARTA las canceladas: hoy, en la agenda de siempre,
 *     una cita cancelada no se dibuja en la cuadrícula. Se mantiene ese
 *     comportamiento — es funcionalidad existente, no diseño.
 */

import { useEffect, useMemo, useState } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { assignLanes } from "@/lib/agenda/lane-layout";
import { scheduleDayOfISO } from "@/lib/agenda/clinic-hours";
import {
  altoDeCita,
  carrilDeCita,
  deHora,
  diaEnTz,
  minutosDeAhora,
  topDeCita,
  ventanaDeRejilla,
} from "@/lib/agenda-nueva/geometria";
import { ALTO_ENCABEZADO_DIA } from "@/lib/agenda-nueva/tokens";
import { aCitaVista, resumenDeColumna, type CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { Cuadricula, type ColumnaCuadricula } from "./cuadricula";
import { TarjetaCita } from "./tarjeta-cita";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import s from "./agenda-nueva.module.css";

/**
 * Un reloj que solo cambia cuando cambia el minuto. La línea de «ahora», los
 * minutos de espera y los de consulta se mueven con él; re-renderizar por
 * segundo sería tirar trabajo a la basura.
 */
function useMinuto(): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    // Primer salto al cambio de minuto exacto, y de ahí cada 60 s.
    const alSiguienteMinuto = 60_000 - (Date.now() % 60_000);
    let intervalo: ReturnType<typeof setInterval> | undefined;
    const arranque = setTimeout(() => {
      setAhora(new Date());
      intervalo = setInterval(() => setAhora(new Date()), 60_000);
    }, alSiguienteMinuto);
    return () => {
      clearTimeout(arranque);
      if (intervalo) clearInterval(intervalo);
    };
  }, []);
  return ahora;
}

export function VistaDia() {
  const { state } = useAgenda();
  const ag = useAgendaNueva();
  const ahora = useMinuto();

  const ventana = useMemo(
    () => ventanaDeRejilla(state.dayStart, state.dayEnd),
    [state.dayStart, state.dayEnd],
  );

  // El horario REAL de este día, de Ajustes. De aquí salen la franja de cierre
  // y el «Cerrado» — no de un 18:00 escrito a mano.
  const horarioDelDia = useMemo(() => {
    const dow = scheduleDayOfISO(state.dayISO, state.timezone);
    const fila = state.schedules?.find((d) => d.dayOfWeek === dow);
    if (!fila) return { abre: null, cierra: null, cerrado: false };
    if (!fila.enabled) return { abre: null, cierra: null, cerrado: true };
    return { abre: deHora(fila.openTime), cierra: deHora(fila.closeTime), cerrado: false };
  }, [state.schedules, state.dayISO, state.timezone]);

  // Solo las citas de ESTE día calendario en la zona de la clínica. El payload
  // de un rango puede traer vecinas; sin este filtro se colarían arriba.
  const citasDelDia = useMemo(
    () =>
      state.appointments.filter(
        (a) => diaEnTz(a.startsAt, state.timezone) === state.dayISO,
      ),
    [state.appointments, state.dayISO, state.timezone],
  );

  const columnas = useMemo<ColumnaCuadricula[]>(() => {
    const ctx = {
      timezone: state.timezone,
      doctores: state.doctors,
      unidades: state.resources,
      ahora,
    };

    return ag.responsablesVisibles.map((r) => {
      const suyas = citasDelDia.filter(
        (a) => a.doctor?.id === r.id && ag.citaVisible(a.doctor?.id ?? null, a.resourceId),
      );

      // Carriles primero (sobre el DTO, que es lo que assignLanes entiende),
      // y luego el modelo de vista. Así el reparto es idéntico al de siempre.
      const carriles = assignLanes(suyas, state.slotMinutes);
      const vistas: Array<{ cita: CitaVista; lane: number; laneCount: number }> = carriles.map(
        (c) => ({
          cita: aCitaVista(c.appt, ctx),
          lane: c.lane,
          laneCount: c.laneCount,
        }),
      );

      const paraResumen = suyas.map((a) => aCitaVista(a, ctx));

      return {
        clave: r.id,
        fondo: undefined,
        cierreDesdeMin: horarioDelDia.cierra,
        aperturaHastaMin: horarioDelDia.abre,
        cerrada: horarioDelDia.cerrado,
        vacia: vistas.length === 0 && !horarioDelDia.cerrado ? "Sin citas" : null,
        encabezado: (
          <div className={s.cabeceraDia}>
            <span className={s.avatarResponsable} style={{ background: r.color }}>
              {r.iniciales}
            </span>
            <div className={s.cabeceraTextos}>
              <div className={s.cabeceraNombre}>{r.nombre}</div>
              <div className={s.cabeceraSub}>{resumenDeColumna(paraResumen)}</div>
            </div>
          </div>
        ),
        contenido: vistas.map(({ cita, lane, laneCount }) => (
          <TarjetaCita
            key={cita.id}
            cita={cita}
            variante="dia"
            seleccionada={ag.citaAbiertaId === cita.id}
            onAbrir={ag.abrirCita}
            geometria={{
              top: topDeCita(cita.inicioMin, ventana.minutoInicio),
              alto: altoDeCita(cita.duracionMin),
              carriles: laneCount,
              ...carrilDeCita(lane, laneCount),
            }}
          />
        )),
      };
    });
  }, [
    ag,
    ahora,
    citasDelDia,
    horarioDelDia,
    state.doctors,
    state.resources,
    state.slotMinutes,
    state.timezone,
    ventana.minutoInicio,
  ]);

  const ahoraMin = minutosDeAhora({
    dayISO: state.dayISO,
    timezone: state.timezone,
    ventana,
    ahora,
  });

  return (
    <Cuadricula
      ventana={ventana}
      columnas={columnas}
      altoEncabezado={ALTO_ENCABEZADO_DIA}
      ahoraMin={ahoraMin}
      columnaAhora={null}
      sinColumnas={
        ag.responsablesTodos.length === 0
          ? "No hay doctores activos en la agenda. Actívalos en Equipo."
          : "Ningún doctor ni unidad seleccionada"
      }
    />
  );
}

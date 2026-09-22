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

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { assignLanes } from "@/lib/agenda/lane-layout";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { citaArrastrable } from "@/lib/agenda-nueva/interacciones";
import { horarioDelDia as horarioDeAjustes } from "@/lib/agenda-nueva/ocupacion";
import {
  altoDeCita,
  carrilDeCita,
  diaEnTz,
  minutosDeAhora,
  topDeCita,
  ventanaDeRejilla,
} from "@/lib/agenda-nueva/geometria";
import { ALTO_ENCABEZADO_DIA } from "@/lib/agenda-nueva/tokens";
import { aCitaVista, resumenDeColumna, type CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { Cuadricula, type ColumnaCuadricula } from "./cuadricula";
import { TarjetaCita } from "./tarjeta-cita";
import { FantasmaCita } from "./fantasma-cita";
import { useArrastreCitas } from "./arrastre-citas";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import { useBloqueosAgenda } from "@/components/dashboard/bloqueos/usar-bloqueos-agenda";
import { bandasDelDia } from "@/components/dashboard/bloqueos/fechas";
import { useMinuto } from "./usar-minuto";
import s from "./agenda-nueva.module.css";

export function VistaDia() {
  const { state, permissions } = useAgenda();
  const { open: abrirNuevaCita } = useNewAppointmentDialog();
  const { destino } = useArrastreCitas();
  // Se saca del contexto SOLO lo que se usa. Depender del objeto `ag` entero
  // recalcularía todas las citas del día cada vez que se abre o se cierra un
  // panel, porque su identidad cambia con el estado de la pantalla.
  const { responsablesVisibles, responsablesTodos, citaVisible, citaAbiertaId, abrirCita } =
    useAgendaNueva();
  const ahora = useMinuto();
  // Los bloqueos del periodo, del MISMO payload que ya trae las citas (ws1-t2).
  // Mientras su rama no esté integrada esto es una lista vacía y la rejilla se
  // pinta exactamente como hoy.
  const bloqueos = useBloqueosAgenda();

  const ventana = useMemo(
    () => ventanaDeRejilla(state.dayStart, state.dayEnd),
    [state.dayStart, state.dayEnd],
  );

  // El horario REAL de este día, de Ajustes. De aquí salen la franja de cierre
  // y el «Cerrado» — no de un 18:00 escrito a mano. Y de aquí sale también
  // dónde se acepta un clic para agendar, así que se lee con la MISMA función
  // que Semana y Mes (`horarioDelDia` de ocupacion.ts): un día sin fila en
  // Ajustes no podía salir «Cerrado» en Semana y abierto en Día.
  const horarioDelDia = useMemo(() => {
    const h = horarioDeAjustes(state.dayISO, state.schedules, state.timezone);
    // Sin ningún horario utilizable en Ajustes: la ventana de la clínica, la
    // misma que dibuja la agenda de siempre (fuera de ella no hay dónde hacer
    // clic). La cuadrícula nueva se pinta de 8 a 20 igualmente.
    if (h === null) return { abre: state.dayStart * 60, cierra: state.dayEnd * 60, cerrado: false };
    if (!h.abierto) return { abre: null, cierra: null, cerrado: true };
    return { abre: h.aperturaMin, cierra: h.cierreMin, cerrado: false };
  }, [state.schedules, state.dayISO, state.timezone, state.dayStart, state.dayEnd]);

  // Solo las citas de ESTE día calendario en la zona de la clínica. El payload
  // de un rango puede traer vecinas; sin este filtro se colarían arriba.
  const citasDelDia = useMemo(
    () =>
      state.appointments.filter(
        (a) => diaEnTz(a.startsAt, state.timezone) === state.dayISO,
      ),
    [state.appointments, state.dayISO, state.timezone],
  );

  // Las franjas de bloqueo del día, por columna. Aparte del `useMemo` de las
  // columnas para que moverse por la rejilla no las recalcule: dependen solo
  // del día, de la zona y de la lista de bloqueos.
  const bandasPorResponsable = useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof bandasDelDia>>();
    if (bloqueos.length === 0) return mapa;
    for (const r of responsablesVisibles) {
      const bandas = bandasDelDia(bloqueos, state.dayISO, state.timezone, r.id);
      if (bandas.length > 0) mapa.set(r.id, bandas);
    }
    return mapa;
  }, [bloqueos, responsablesVisibles, state.dayISO, state.timezone]);

  const columnas = useMemo<ColumnaCuadricula[]>(() => {
    const ctx = {
      timezone: state.timezone,
      doctores: state.doctors,
      unidades: state.resources,
      ahora,
    };

    return responsablesVisibles.map((r) => {
      const suyas = citasDelDia.filter(
        (a) => a.doctor?.id === r.id && citaVisible(a.doctor?.id ?? null, a.resourceId),
      );

      // Carriles primero (sobre el DTO, que es lo que assignLanes entiende),
      // y luego el modelo de vista. Así el reparto es idéntico al de siempre.
      // El 30 es la duración que se le supone a una cita SIN `endsAt`, NO el
      // paso de la rejilla: tiene que ser el mismo que usa `aCitaVista`, o el
      // carril y la tarjeta discreparían el día que `endsAt` deje de ser
      // obligatorio.
      const carriles = assignLanes(suyas, 30);
      const vistas: Array<{ cita: CitaVista; lane: number; laneCount: number }> = carriles.map(
        (c) => ({
          cita: aCitaVista(c.appt, ctx),
          lane: c.lane,
          laneCount: c.laneCount,
        }),
      );

      const paraResumen = suyas.map((a) => aCitaVista(a, ctx));

      // Soltar aquí cambia el DOCTOR: el mismo `doctor-col` que usan las
      // columnas de la agenda de siempre.
      const columnKey = `doctor:${r.id}`;

      return {
        clave: r.id,
        soltable: {
          id: `col:${columnKey}`,
          data: { kind: "doctor-col" as const, columnKey, doctorId: r.id, resourceId: null },
        },
        // Clic en un hueco libre → la ventana de «Nueva cita» de siempre, con
        // el día, la hora del hueco y el doctor de esta columna. Exactamente
        // lo que abre `AgendaColumn`. Sin permiso de crear, la columna no
        // acepta clics (P1-3).
        alPulsarHueco: permissions.canCreate
          ? ({ inicioMin }: { inicioMin: number }) =>
              abrirNuevaCita({
                initialSlot: {
                  startsAt: tzLocalToUtc(
                    state.dayISO,
                    Math.floor(inicioMin / 60),
                    inicioMin % 60,
                    state.timezone,
                  ).toISOString(),
                  doctorId: r.id,
                  resourceId: null,
                },
                openAgendaAfter: true,
              })
          : undefined,
        fondo: undefined,
        bloqueos: bandasPorResponsable.get(r.id),
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
            seleccionada={citaAbiertaId === cita.id}
            onAbrir={abrirCita}
            arrastrable={citaArrastrable(cita.dto, permissions.canEdit)}
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
    // Campos sueltos y no el objeto `ag` entero: su identidad cambia al abrir
    // o cerrar un panel, y con él de dependencia se recalculaban todas las
    // citas del día cada vez que se pulsaba una.
  }, [
    responsablesVisibles,
    citaVisible,
    citaAbiertaId,
    abrirCita,
    abrirNuevaCita,
    permissions.canCreate,
    permissions.canEdit,
    ahora,
    bandasPorResponsable,
    citasDelDia,
    horarioDelDia,
    state.dayISO,
    state.doctors,
    state.resources,
    state.timezone,
    ventana.minutoInicio,
  ]);

  // La sombra de la cita que se arrastra, en la columna del doctor de destino.
  // Va aparte de `columnas` a propósito: cambia en cada hueco que cruza el
  // puntero, y así no se vuelven a construir todas las tarjetas del día.
  const columnasConSombra = useMemo(() => {
    if (!destino || destino.target.kind !== "doctor-col") return columnas;
    const doctorId = destino.target.doctorId;
    return columnas.map((c) =>
      c.clave === doctorId
        ? {
            ...c,
            superpuesto: (
              <FantasmaCita
                plan={destino.plan}
                timezone={state.timezone}
                minutoInicio={ventana.minutoInicio}
                left="8px"
                width="calc(100% - 16px)"
              />
            ),
          }
        : c,
    );
  }, [columnas, destino, state.timezone, ventana.minutoInicio]);

  const ahoraMin = minutosDeAhora({
    dayISO: state.dayISO,
    timezone: state.timezone,
    ventana,
    ahora,
  });

  return (
    <Cuadricula
      ventana={ventana}
      columnas={columnasConSombra}
      slotMinutes={state.slotMinutes}
      altoEncabezado={ALTO_ENCABEZADO_DIA}
      ahoraMin={ahoraMin}
      columnaAhora={null}
      sinColumnas={
        responsablesTodos.length === 0
          ? "No hay doctores activos en la agenda. Actívalos en Equipo."
          : "Ningún doctor ni unidad seleccionada"
      }
    />
  );
}

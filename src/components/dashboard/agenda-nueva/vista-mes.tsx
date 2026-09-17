"use client";

/**
 * VISTA MES de la agenda nueva (WS1-T2) — la cuadrícula del mes con la barra
 * de ocupación de cada día, partida por responsable en su color.
 *
 * ── El porcentaje es de verdad ───────────────────────────────────────────
 * El README del diseño fija la capacidad de un día en «30 citas de lunes a
 * viernes y 15 el sábado». Ese número es del PROTOTIPO: sale de tres doctores
 * inventados y no tiene nada que ver con la clínica que abre la pantalla. Aquí
 * la capacidad la calcula `ocupacion.ts` con el horario real de `ClinicSchedule`
 * por los responsables visibles, contra los minutos que las citas ocupan de
 * verdad. Cuando eso NO se puede calcular (clínica sin horario configurado en
 * Ajustes, o filtro que apaga a todos los responsables) no se enseña barra ni
 * porcentaje: un número de ocupación falso es peor que ninguno, porque es el
 * número con el que un dueño decide si contrata o si abre los sábados.
 *
 * ── Y no hay feriados ────────────────────────────────────────────────────
 * El prototipo marca el 16 de septiembre como «Feriado · Independencia». En
 * Dental no existe modelo de días festivos ni de bloqueos de agenda: lo único
 * que sabe el sistema es `ClinicSchedule`. Así que un día cerrado dice
 * «Cerrado» y nunca inventa el motivo. Ver `ocupacion.ts` para el detalle.
 */

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import { aCitaVista, type CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { diaEnTz } from "@/lib/agenda-nueva/geometria";
import {
  notaDelDia,
  ocupacionDelDia,
  type Carril,
  type OcupacionDia,
} from "@/lib/agenda-nueva/ocupacion";
import { ABREVIATURAS_SEMANA, filasDelMes, type CeldaMes } from "@/lib/agenda-nueva/calendario";
import { todayInTz } from "@/lib/agenda/time-utils";
import css from "./vista-semana-mes.module.css";

export interface PropsVistaMes {
  /** El reloj. Se inyecta para poder probar qué celda es «hoy». */
  ahora?: Date;
}

export function VistaMes(props: PropsVistaMes) {
  const { state, setDay } = useAgenda();
  // El filtro y los responsables visibles salen del contexto de la agenda
  // nueva (WS1-T1): la leyenda del mes, los carriles de la semana y las
  // columnas del día tienen que enseñar exactamente lo mismo.
  const nueva = useAgendaNueva();
  const ahora = props.ahora ?? new Date();
  const hoyISO = todayInTz(state.timezone);

  const filas = useMemo(() => filasDelMes(state.dayISO), [state.dayISO]);
  const responsables = nueva.responsablesVisibles;
  const citas = useCitasDelMes(ahora);

  const carriles: Carril[] = useMemo(
    () => responsables.map((r) => ({ id: r.id, nombre: r.nombreCorto, color: r.color })),
    [responsables],
  );

  const irADia = (dayISO: string) => {
    setDay(dayISO);
    nueva.irAVista("dia");
  };

  // Una sola pasada por el lote para agrupar por día, y después una llamada a
  // `ocupacionDelDia` por celda. Con un `filter` por celda serían 42 recorridos
  // del mes entero cada vez que cambia el filtro.
  const ocupacionPorDia = useMemo(() => {
    const porDia = new Map<string, CitaVista[]>();
    for (const cita of citas) {
      const iso = diaEnTz(cita.dto.startsAt, state.timezone);
      const lista = porDia.get(iso);
      if (lista) lista.push(cita);
      else porDia.set(iso, [cita]);
    }
    const salida = new Map<string, OcupacionDia>();
    for (const fila of filas) {
      for (const celda of fila) {
        salida.set(
          celda.iso,
          ocupacionDelDia({
            dayISO: celda.iso,
            citas: (porDia.get(celda.iso) ?? []).map((c) => ({
              startsAt: c.dto.startsAt,
              endsAt: c.dto.endsAt,
              status: c.estado,
              doctorId: c.responsableId,
              resourceId: c.unidadId,
            })),
            schedules: state.schedules,
            timezone: state.timezone,
            carriles,
          }),
        );
      }
    }
    return salida;
  }, [citas, filas, carriles, state.schedules, state.timezone]);

  const celdas = filas.flat();

  return (
    <div className={css.mes}>
      <div className={css.ayuda}>
        <span>Cada barra es la ocupación del día por responsable</span>
        <span className={css.espaciador} />
        <div className={css.leyenda}>
          {responsables.map((r) => (
            <span key={r.id} className={css.leyendaItem}>
              <span className={css.leyendaColor} style={{ background: r.color }} />
              {r.nombreCorto}
            </span>
          ))}
        </div>
      </div>

      <div className={css.cabeceraSemana} aria-hidden>
        {ABREVIATURAS_SEMANA.map((abrev) => (
          <div key={abrev} className={css.cabeceraSemanaCelda}>
            {/* «LUN» en el diseño; en la cabecera del mes va con inicial
                mayúscula y el resto en minúscula por CSS (text-transform). */}
            {abrev}
          </div>
        ))}
      </div>

      <div
        className={css.rejilla}
        style={{ gridTemplateRows: `repeat(${filas.length}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Cuadrícula del mes"
      >
        {celdas.map((celda) => (
          <CeldaDelMes
            key={celda.iso}
            celda={celda}
            ocupacion={ocupacionPorDia.get(celda.iso)!}
            esHoy={celda.iso === hoyISO}
            esPasado={celda.iso < hoyISO}
            esSeleccionado={celda.iso === state.dayISO}
            onAbrir={() => irADia(celda.iso)}
          />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────── una celda del mes ─────────────────────────── */

function CeldaDelMes(props: {
  celda: CeldaMes;
  ocupacion: OcupacionDia;
  esHoy: boolean;
  esPasado: boolean;
  esSeleccionado: boolean;
  onAbrir: () => void;
}) {
  const { celda, ocupacion, esHoy, esPasado, esSeleccionado } = props;
  const nota = notaDelDia(ocupacion);
  const hayBarra = !ocupacion.cerrado && ocupacion.porcentaje !== null;

  const clases = [
    css.celda,
    celda.fuera ? css.celdaFuera : "",
    esPasado && !esHoy ? css.celdaPasada : "",
    esHoy ? css.celdaHoy : "",
    ocupacion.cerrado ? css.celdaCerrada : "",
    esSeleccionado && !esHoy ? css.celdaSeleccionada : "",
  ]
    .filter(Boolean)
    .join(" ");

  // El `title` explica de dónde sale el número, para que nadie tenga que
  // adivinar si «63% ocupado» es sobre 30 citas inventadas o sobre el horario
  // de su clínica.
  const explicacion = ocupacion.cerrado
    ? "La clínica no abre este día según el horario de Ajustes."
    : ocupacion.horarioDesconocido
    ? "Sin horario configurado en Ajustes no se puede calcular la ocupación."
    : ocupacion.porcentaje === null
    ? "Sin responsables visibles no se puede calcular la ocupación."
    : `${horas(ocupacion.minutosOcupados)} ocupadas de ${horas(ocupacion.minutosDisponibles)} disponibles`;

  return (
    <div
      className={clases}
      role="gridcell"
      tabIndex={0}
      onClick={props.onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onAbrir();
        }
      }}
      aria-label={`Día ${celda.numero}: ${ocupacion.totalCitas} citas. ${explicacion}`}
      title={explicacion}
    >
      <div className={css.celdaCabecera}>
        <span className={[css.numero, esHoy ? css.numeroHoy : ""].join(" ")}>
          {celda.numero}
        </span>
        <span className={css.espaciador} />
        {ocupacion.totalCitas > 0 && (
          <span className={css.conteo}>
            {ocupacion.totalCitas} {ocupacion.totalCitas === 1 ? "cita" : "citas"}
          </span>
        )}
      </div>

      {hayBarra && (
        <>
          <div className={css.barra}>
            {ocupacion.segmentos
              .filter((s) => s.fraccion > 0)
              .map((s) => (
                <div
                  key={s.carrilId}
                  className={css.segmento}
                  style={{ width: `${s.fraccion * 100}%`, background: s.color }}
                />
              ))}
          </div>
          <div className={css.porcentaje}>{ocupacion.porcentaje}% ocupado</div>
        </>
      )}

      {nota && (
        <div
          className={[
            css.nota,
            nota.tipo === "sin-confirmar" ? css.notaAmbar : css.notaGris,
          ].join(" ")}
        >
          {nota.texto}
        </div>
      )}
    </div>
  );
}

/** «7 h 30 min» — para el `title` que explica de dónde sale el porcentaje. */
function horas(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/* ───────────────────────── las citas que cuenta el mes ──────────────────── */

/**
 * Las citas del rango del mes (42 días) pasadas por el filtro del contexto.
 *
 * Las canceladas SÍ entran aquí: las descarta `ocupacionDelDia`, para que el
 * criterio de qué cuenta como cita viva viva en un solo sitio y no en cada
 * pantalla.
 */
function useCitasDelMes(ahora: Date): CitaVista[] {
  const { state } = useAgenda();
  const { citaVisible } = useAgendaNueva();

  return useMemo(
    () => {
      const ctx = {
        timezone: state.timezone,
        doctores: state.doctors,
        unidades: state.resources,
        ahora,
      };
      return state.appointments
        .filter((a) => citaVisible(a.doctor?.id ?? null, a.resourceId))
        .map((a) => aCitaVista(a, ctx));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.appointments, state.doctors, state.resources, state.timezone, citaVisible],
  );
}

"use client";

/**
 * VISTA SEMANA de la agenda nueva (WS1-T2) — siete columnas de día, un carril
 * por responsable dentro de cada día, tarjetas compactas y los días cerrados
 * marcados.
 *
 * No dibuja su propia cuadrícula: usa la de `agenda-nueva/cuadricula.tsx`
 * (WS1-T1), la MISMA que la vista Día. Ese es el punto del rediseño — si cada
 * vista pintara su rejilla acabaríamos con dos agendas que se parecen y no son
 * iguales, que es justo el problema que este trabajo existe para arreglar. Lo
 * único propio de aquí es que cada columna es un DÍA y no un responsable.
 *
 * Datos reales de la clínica, nada del prototipo: los días abiertos, el
 * horario de cada uno y la franja de cierre salen de `ClinicSchedule`; los
 * responsables son los doctores de la clínica con el color que tienen en
 * Equipo.
 */

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import { Cuadricula, type ColumnaCuadricula } from "./cuadricula";
import { TarjetaCita } from "./tarjeta-cita";
import { FantasmaCita } from "./fantasma-cita";
import { useArrastreCitas } from "./arrastre-citas";
import { carrilDeClic, citaArrastrable } from "@/lib/agenda-nueva/interacciones";
import { ALTO_ENCABEZADO_SEMANA } from "@/lib/agenda-nueva/tokens";
import {
  altoDeCita,
  diaEnTz,
  minutosDeAhora,
  topDeCita,
  ventanaDeRejilla,
} from "@/lib/agenda-nueva/geometria";
import { aCitaVista, type CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { carrilesConHuerfanos, horarioDelDia } from "@/lib/agenda-nueva/ocupacion";
import { citaContada } from "@/lib/agenda-nueva/estados";
import { diasDeLaSemana, type DiaSemana } from "@/lib/agenda-nueva/calendario";
import { assignLanes } from "@/lib/agenda/lane-layout";
import { todayInTz, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { doctorColorFor } from "@/lib/agenda/doctor-color";
import css from "./vista-semana-mes.module.css";

/**
 * Ancho mínimo de un carril de responsable, en px. Por debajo de esto la
 * tarjeta compacta deja de decir nada: el nombre del paciente se queda en «|».
 *
 * El número sale del PROPIO diseño. El lienzo de referencia del paquete es
 * 1920: menos los 248 px del menú y los 64 del eje quedan 1608 para siete
 * días, o sea 230 px por día, que con tres responsables son 76 px por carril
 * —y ahí el prototipo ya recorta «Valeria Sánchez» a «Val…»—. Así que 76 es
 * la densidad que Rafael aprobó, no una cifra elegida por mí.
 *
 * Con esto, a 1920 la semana entra sin desplazarse (idéntica al diseño) y en
 * pantallas más estrechas la cuadrícula se DESPLAZA en horizontal en vez de
 * seguir encogiendo, que es justo lo que manda el README: «En pantallas
 * pequeñas la cuadrícula se desplaza».
 */
const ANCHO_MINIMO_CARRIL = 76;

export interface PropsVistaSemana {
  /** El reloj. Se inyecta para poder probar la línea de «ahora». */
  ahora?: Date;
}

export function VistaSemana(props: PropsVistaSemana) {
  const { state, setDay, permissions } = useAgenda();
  const { open: abrirNuevaCita } = useNewAppointmentDialog();
  const { destino } = useArrastreCitas();
  // El filtro de doctores y unidades y la cita abierta viven en el contexto de
  // la agenda nueva (WS1-T1), no en `state.filters`: Día, Semana, Mes y el
  // buscador de huecos filtran todos de la MISMA fuente, que es lo que impide
  // que el mismo doctor esté visible en una vista y escondido en otra.
  const nueva = useAgendaNueva();
  const ahora = props.ahora ?? new Date();
  const hoyISO = todayInTz(state.timezone);

  const dias = useMemo(() => diasDeLaSemana(state.dayISO), [state.dayISO]);

  // La ventana sale de `state.dayStart/dayEnd`, que el provider ya calcula con
  // los SIETE días cuando la vista no es Día: un sábado que abriera antes que
  // el resto ensancha el lienzo en vez de dejarse su primera cita fuera.
  const ventana = useMemo(
    () => ventanaDeRejilla(state.dayStart, state.dayEnd),
    [state.dayStart, state.dayEnd],
  );

  const responsables = nueva.responsablesVisibles;
  const citas = useCitasDeLaSemana(ahora);

  const irADia = (dayISO: string) => {
    setDay(dayISO);
    nueva.irAVista("dia");
  };

  // Las citas de cada día, en la zona de la clínica. Una sola pasada: con un
  // `filter` por columna serían siete recorridos del lote entero.
  const porDia = useMemo(() => {
    const mapa = new Map<string, CitaVista[]>();
    for (const cita of citas) {
      const iso = diaEnTz(cita.dto.startsAt, state.timezone);
      const lista = mapa.get(iso);
      if (lista) lista.push(cita);
      else mapa.set(iso, [cita]);
    }
    return mapa;
  }, [citas, state.timezone]);

  // Cuántos carriles llega a tener el día más poblado de la semana: el ancho
  // mínimo de columna se calcula con ése, para que ninguna columna quede más
  // apretada que el resto. Sobre los responsables VISIBLES, no los totales —
  // con seis doctores y cinco desmarcados, arrastraríamos scroll para nada.
  let maxCarriles = Math.max(1, responsables.length);

  const columnas: ColumnaCuadricula[] = dias.map((dia) => {
    const delDia = porDia.get(dia.iso) ?? [];
    const horario = horarioDelDia(dia.iso, state.schedules, state.timezone);
    const cerrada = horario !== null && !horario.abierto;
    const esHoy = dia.iso === hoyISO;

    // Los carriles son los responsables visibles MÁS quien tenga citas ese día
    // sin columna propia (un doctor dado de baja conserva sus citas futuras);
    // sin esa unión sus citas desaparecerían de la semana aunque el contador
    // de la cabecera las siguiera sumando.
    const carriles = carrilesConHuerfanos(
      responsables.map((r) => ({ id: r.id, nombre: r.nombreCorto, color: r.color })),
      delDia.map((c) => ({
        startsAt: c.dto.startsAt,
        endsAt: c.dto.endsAt,
        status: c.estado,
        doctorId: c.responsableId,
        resourceId: c.unidadId,
      })),
      (id) => {
        const suya = delDia.find((c) => c.responsableId === id);
        return {
          id,
          nombre: suya?.responsableNombre ?? "Profesional",
          color: suya?.colorResponsable ?? doctorColorFor(id, null),
        };
      },
    );

    if (carriles.length > maxCarriles) maxCarriles = carriles.length;

    // La sombra de la cita que se arrastra, si el puntero está sobre ESTE día.
    // Va en el carril de su doctor: en la semana, soltar cambia el día y la
    // hora, nunca el doctor (igual que la semana de siempre).
    let sombra: React.ReactNode = null;
    if (destino && destino.target.kind === "day-col" && destino.target.dayISO === dia.iso) {
      const total = Math.max(1, carriles.length);
      const i = carriles.findIndex((c) => c.id === destino.plan.newDoctorId);
      const ancho = 100 / total;
      sombra = (
        <FantasmaCita
          plan={destino.plan}
          timezone={state.timezone}
          minutoInicio={ventana.minutoInicio}
          left={i >= 0 ? `calc(${i * ancho}% + 2px)` : "2px"}
          width={i >= 0 ? `calc(${ancho}% - 4px)` : "calc(100% - 4px)"}
          compacta
        />
      );
    }

    return {
      clave: dia.iso,
      // Soltar aquí cambia el DÍA: el mismo `day-col` de la semana de siempre.
      soltable: { id: `dia:${dia.iso}`, data: { kind: "day-col" as const, dayISO: dia.iso } },
      // Clic en un hueco libre → «Nueva cita» con ese día, esa hora y el
      // responsable del carril donde cayó el clic.
      alPulsarHueco: permissions.canCreate
        ? ({ inicioMin, fraccionX }: { inicioMin: number; fraccionX: number }) => {
            const carril = carriles.length > 0 ? carriles[carrilDeClic(fraccionX, carriles.length)] : undefined;
            abrirNuevaCita({
              initialSlot: {
                startsAt: tzLocalToUtc(
                  dia.iso,
                  Math.floor(inicioMin / 60),
                  inicioMin % 60,
                  state.timezone,
                ).toISOString(),
                doctorId: carril?.id,
                resourceId: null,
              },
              openAgendaAfter: true,
            });
          }
        : undefined,
      carriles: carriles.length,
      superpuesto: sombra,
      encabezado: (
        <CabeceraDia
          dia={dia}
          esHoy={esHoy}
          cerrada={cerrada}
          citas={delDia.length}
          onAbrir={() => irADia(dia.iso)}
        />
      ),
      contenido: (
        <ColumnaDeDia
          citas={delDia}
          carriles={carriles}
          minutoInicio={ventana.minutoInicio}
          slotMinutes={state.slotMinutes}
          citaAbiertaId={nueva.citaAbiertaId}
          onAbrirCita={nueva.abrirCita}
          puedeEditar={permissions.canEdit}
        />
      ),
      fondo: esHoy
        ? "var(--ag-hoy)"
        : cerrada
        ? "var(--ag-fondo-cerrado)"
        : undefined,
      cerrada,
      // Las rayas de lo que NO es horario de atención van POR DÍA: el sábado
      // casi siempre cierra antes que el resto de la semana, y con un solo
      // valor para las siete columnas o el sábado queda sin rayar o el resto
      // queda rayado de más.
      // Sin ningún horario en Ajustes (`horario === null`), la ventana de la
      // clínica: fuera de ella tampoco se agenda con un clic (igual que Día).
      cierreDesdeMin: horario === null ? state.dayEnd * 60 : horario.cierreMin ?? null,
      aperturaHastaMin:
        horario === null
          ? state.dayStart * 60
          : horario.aperturaMin != null && horario.aperturaMin > ventana.minutoInicio
          ? horario.aperturaMin
          : null,
    };
  });

  return (
    <Cuadricula
      ventana={ventana}
      columnas={columnas}
      altoEncabezado={ALTO_ENCABEZADO_SEMANA}
      ahoraMin={minutosDeAhora({
        dayISO: hoyISO,
        timezone: state.timezone,
        ventana,
        ahora,
      })}
      // La línea de «ahora» va SOLO en la columna de hoy. Cruzada a lo ancho
      // de la semana diría que son las 11:20 del lunes y del domingo a la vez.
      columnaAhora={hoyISO}
      anchoMinimoColumna={maxCarriles * ANCHO_MINIMO_CARRIL}
      slotMinutes={state.slotMinutes}
    />
  );
}

/* ─────────────────────────── cabecera de un día ─────────────────────────── */

function CabeceraDia(props: {
  dia: DiaSemana;
  esHoy: boolean;
  cerrada: boolean;
  citas: number;
  onAbrir: () => void;
}) {
  const { dia, esHoy, cerrada, citas } = props;
  const etiqueta = `${dia.abreviatura} ${dia.numero}`;
  return (
    <button
      type="button"
      className={css.cabeceraDia}
      onClick={props.onAbrir}
      aria-label={`${etiqueta} · abrir en la vista Día`}
      title={`Abrir el ${dia.numero} en la vista Día`}
    >
      <span className={[css.cabeceraAbrev, esHoy ? css.cabeceraAbrevHoy : ""].join(" ")}>
        {dia.abreviatura}
      </span>
      <span className={[css.cabeceraNumero, esHoy ? css.cabeceraNumeroHoy : ""].join(" ")}>
        {dia.numero}
      </span>
      <span className={css.espaciador} />
      <span className={css.cabeceraConteo}>
        {cerrada ? "Cerrado" : `${citas} ${citas === 1 ? "cita" : "citas"}`}
      </span>
    </button>
  );
}

/* ──────────────────────── el contenido de una columna ───────────────────── */

interface CarrilResponsable {
  id: string;
  nombre: string;
  color: string;
}

function ColumnaDeDia(props: {
  citas: readonly CitaVista[];
  carriles: readonly CarrilResponsable[];
  minutoInicio: number;
  slotMinutes: number;
  citaAbiertaId: string | null;
  onAbrirCita: (id: string) => void;
  puedeEditar: boolean;
}) {
  const { citas, carriles, minutoInicio, slotMinutes } = props;

  // Cada responsable tiene su carril dentro del día (README: `left =
  // i/n·100% + 2px`, `width = 100%/n − 4px`). Y DENTRO de su carril, dos citas
  // que se pisan se reparten el ancho con `assignLanes` —el mismo algoritmo
  // que usa la agenda de siempre—: el prototipo no contempla el solape porque
  // sus datos de ejemplo no lo tienen, pero en una clínica de verdad pasa, y
  // apilarlas escondería la de abajo del todo.
  const colocadas = useMemo(() => {
    const total = Math.max(1, carriles.length);
    const anchoCarril = 100 / total;
    const salida: Array<{ cita: CitaVista; left: string; width: string }> = [];

    carriles.forEach((carril, i) => {
      const suyas = citas.filter((c) => c.responsableId === carril.id);
      if (suyas.length === 0) return;
      const izquierda = i * anchoCarril;
      const porId = new Map(suyas.map((c) => [c.id, c]));
      for (const { appt, lane, laneCount } of assignLanes(
        suyas.map((c) => c.dto),
        slotMinutes,
      )) {
        const cita = porId.get(appt.id);
        if (!cita) continue;
        const anchoSub = anchoCarril / Math.max(1, laneCount);
        salida.push({
          cita,
          left: `calc(${izquierda + lane * anchoSub}% + 2px)`,
          width: `calc(${anchoSub}% - 4px)`,
        });
      }
    });
    return salida;
  }, [citas, carriles, slotMinutes]);

  return (
    <>
      {colocadas.map(({ cita, left, width }) => (
        <TarjetaCita
          key={cita.id}
          cita={cita}
          variante="semana"
          geometria={{
            top: topDeCita(cita.inicioMin, minutoInicio),
            alto: altoDeCita(cita.duracionMin),
            left,
            width,
          }}
          seleccionada={cita.id === props.citaAbiertaId}
          onAbrir={props.onAbrirCita}
          arrastrable={citaArrastrable(cita.dto, props.puedeEditar)}
        />
      ))}
    </>
  );
}

/* ─────────────────────── las citas que pinta la semana ──────────────────── */

/**
 * Las citas del rango convertidas al modelo de vista, pasadas por el filtro
 * del contexto.
 *
 * Las CANCELADAS no se pintan, igual que en la vista Día de siempre
 * (`assignLanes` las descarta desde hace tiempo). Que una cita salga en una
 * vista y no en la otra es de las cosas que hacen desconfiar de la pantalla
 * entera, así que la Semana se comporta como el Día.
 */
function useCitasDeLaSemana(ahora: Date): CitaVista[] {
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
        .filter((a) => citaContada(a.status))
        .filter((a) => citaVisible(a.doctor?.id ?? null, a.resourceId))
        .map((a) => aCitaVista(a, ctx));
    },
    // `ahora` cambia en cada render y se queda fuera de las dependencias a
    // propósito: solo alimenta los minutos de espera del detalle, que se
    // refrescan con el resto cuando llegan citas nuevas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.appointments, state.doctors, state.resources, state.timezone, citaVisible],
  );
}

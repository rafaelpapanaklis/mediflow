"use client";

/**
 * Mover una cita arrastrándola, en Día y en Semana.
 *
 * ⛔ Aquí no hay una lógica nueva de mover. Es la de la agenda de siempre, que
 * vive ahora en `reschedule-flow.ts` y que `AgendaShell` usa igual:
 *
 *   arrastrar (dnd-kit, umbral de 6 px) → `planReschedule` (misma hora
 *   redondeada, mismo destino por columna, mismo aviso de choque) → ventana de
 *   confirmación → `commitReschedule` (optimista → PATCH de siempre → y si el
 *   servidor dice que no, `ROLLBACK_RESCHEDULE`).
 *
 * Qué permite mover, lo mismo que hoy:
 *   · Día: a otra hora y a la columna de OTRO DOCTOR (`doctor-col`).
 *   · Semana: a otra hora y a OTRO DÍA (`day-col`). El doctor no cambia: la
 *     semana de siempre tampoco lo cambia, aunque aquí cada día se reparta en
 *     carriles por responsable.
 *   · Mes: no se arrastra (la de siempre tampoco).
 *
 * Lo que sí es nuevo es de pantalla: mientras se arrastra, la columna de
 * destino pinta una sombra con la hora a la que caería (`FantasmaCita`), y
 * cuando el servidor rechaza, el aviso dice por qué (`mensajeDeRechazo`) en
 * vez del «No se pudo reprogramar» de siempre para todo.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import toast from "react-hot-toast";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import type { AppointmentDragData, DroppableData } from "@/lib/agenda/drag-utils";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import {
  DRAG_ACTIVATION_DISTANCE_PX,
  commitReschedule,
  planReschedule,
  type PlannedReschedule,
} from "@/lib/agenda/reschedule-flow";
import { ventanaDeRejilla, diaEnTz } from "@/lib/agenda-nueva/geometria";
import { bloqueoQueTapa } from "@/lib/agenda-bloqueos/core";
import { useBloqueosAgenda } from "@/components/dashboard/bloqueos/usar-bloqueos-agenda";
import { altoDeHueco, mensajeDeRechazo, rechazoIncierto } from "@/lib/agenda-nueva/interacciones";
import { ConfirmarMovimiento } from "./confirmar-movimiento";
import { useHorariosFlexibles } from "./usar-agenda-flexible";
import { comidaQuePisa } from "@/lib/horario-doctor/core";
import {
  avisoDesdeAgenda,
  avisoDesdeRechazo,
  type AvisoSobreagenda,
} from "@/lib/agenda/agenda-flexible";

export interface DestinoArrastre {
  /** El `data` de la columna sobre la que está el puntero. */
  target: DroppableData;
  /** Dónde caería si se soltara ahora. */
  plan: PlannedReschedule;
}

interface ArrastreValor {
  /** Id de la cita que se está arrastrando, o `null`. */
  citaArrastrada: string | null;
  /** Dónde caería, o `null` si el puntero está fuera de las columnas. */
  destino: DestinoArrastre | null;
}

const Ctx = createContext<ArrastreValor>({ citaArrastrada: null, destino: null });

export function useArrastreCitas(): ArrastreValor {
  return useContext(Ctx);
}

/**
 * El destino bajo el puntero: primero la columna en la que está el puntero, y
 * si no hay ninguna, la que más pisa la tarjeta. La tarjeta no se mueve en
 * pantalla (la que se mueve es su sombra), así que lo natural es que mande el
 * puntero, no el rectángulo de la tarjeta.
 */
const destinoBajoPuntero: CollisionDetection = (args) => {
  const bajo = pointerWithin(args);
  return bajo.length > 0 ? bajo : rectIntersection(args);
};

/**
 * Lo que dnd-kit le lee a un lector de pantalla mientras se arrastra. Sus
 * textos de fábrica están en inglés y nombran ids internos («Draggable item
 * cita:a190 was moved over droppable area col:doctor:d2»).
 */
const AVISOS_LECTOR: Announcements = {
  onDragStart: () => "Moviendo la cita.",
  onDragOver: ({ over }) => (over ? "Sobre otra columna de la agenda." : "Fuera de la agenda."),
  onDragMove: () => undefined,
  onDragEnd: ({ over }) =>
    over ? "Cita soltada. Confirma el movimiento." : "Cita soltada fuera de la agenda; no se movió.",
  onDragCancel: () => "Movimiento cancelado; la cita no se movió.",
};

const INSTRUCCIONES_LECTOR = {
  draggable: "Para mover la cita, arrástrala con el ratón a otra hora o a otra columna.",
};

function mismoDestino(a: DestinoArrastre | null, b: DestinoArrastre | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.plan.newStartsAt === b.plan.newStartsAt &&
    a.plan.newDoctorId === b.plan.newDoctorId &&
    a.plan.toDayISO === b.plan.toDayISO &&
    a.plan.overlap === b.plan.overlap &&
    a.plan.unchanged === b.plan.unchanged
  );
}

export function ArrastreCitas({ children }: { children: ReactNode }) {
  const { state, dispatch, permissions, invalidateRangeCache, refetchView } = useAgenda();

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  );

  const [citaArrastrada, setCitaArrastrada] = useState<string | null>(null);
  const [destino, setDestino] = useState<DestinoArrastre | null>(null);
  const [pendiente, setPendiente] = useState<PlannedReschedule | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Los bloqueos del rango que la agenda ya tiene cargado (WS1-T3). Aquí NO se
  // pide nada por red: solo se puede soltar sobre columnas que están en
  // pantalla, así que el destino siempre cae dentro del rango que se cargó
  // junto a las citas.
  const bloqueos = useBloqueosAgenda();

  // WS1-T5 (grupo Salamanca) — con la bandera `agenda-flexible`, soltar
  // encima de otra cita o en la comida del doctor NO se rechaza: la ventana de
  // mover pregunta «¿Seguro?» y el PATCH viaja con `sobreagendar: true`.
  const flexEncendida = state.agendaFlexible?.encendida === true;
  const horariosFlexibles = useHorariosFlexibles();
  /** El aviso que mandó el servidor (409 `sobreagendable`) cuando la pantalla no lo vio venir. */
  const [avisoServidor, setAvisoServidor] = useState<AvisoSobreagenda | null>(null);

  /**
   * ¿El destino del arrastre cae dentro de un bloqueo? Con la MISMA función
   * que usa el servidor. `null` en el 99 % de los movimientos, y entonces la
   * ventana de confirmar sale exactamente como hasta hoy.
   */
  const bloqueoDelDestino = useMemo(() => {
    if (!pendiente || bloqueos.length === 0) return null;
    const b = bloqueoQueTapa(
      bloqueos,
      pendiente.newStartsAt,
      pendiente.newEndsAt,
      pendiente.newDoctorId ?? pendiente.original.doctor?.id ?? null,
    );
    return b ? { doctorId: b.doctorId, doctorNombre: b.doctorNombre, reason: b.reason } : null;
  }, [pendiente, bloqueos]);

  /**
   * WS1-T5 — ¿el destino cae encima de otra cita (la que la pantalla tiene
   * cargada) o en la comida del doctor? Con la MISMA función que el servidor
   * para la comida (`comidaQuePisa`). `null` sin bandera o con el hueco libre:
   * entonces la ventana de mover sale exactamente como antes.
   */
  const sobreagendaDelDestino = useMemo<AvisoSobreagenda | null>(() => {
    if (!pendiente) return null;
    // Lo que dijo el servidor manda, aunque la bandera de esta pantalla esté
    // vieja (se encendió con la agenda abierta): si no, el 409 se repetiría
    // a cada clic sin enseñar nada.
    if (avisoServidor) return avisoServidor;
    if (!flexEncendida) return null;
    const doctorId = pendiente.newDoctorId ?? pendiente.original.doctor?.id ?? null;
    // El choque, contando también las citas YA sobreagendadas (`findOverlap`
    // se las salta porque la constraint no las ve; aquí sí cuentan).
    const encima = doctorId ? choquesEnPantalla(pendiente, doctorId, state.appointments) : [];
    const choque = encima[0] ?? null;
    // La comida aunque además se salga del horario (revisión t8, A2): la
    // misma `comidaQuePisa` que el servidor.
    const comida = comidaQuePisa(
      horariosFlexibles,
      new Date(pendiente.newStartsAt),
      new Date(pendiente.newEndsAt),
      doctorId,
      state.timezone,
    );
    // Sin nada que enseñar se manda sin `sobreagendar`: si el servidor ve un
    // choque, contesta 409 con la cita y ESA es la que se pregunta.
    if (!choque && !comida) return null;
    return avisoDesdeAgenda({
      choque: choque
        ? {
            id: choque.id,
            patientName: choque.patient?.name ?? null,
            startsAt: choque.startsAt,
            endsAt: choque.endsAt ?? null,
            doctorId: choque.doctor?.id ?? null,
            resourceId: choque.resourceId,
          }
        : null,
      comida,
      intento: { doctorId, resourceId: pendiente.newResourceId },
      timeZone: state.timezone,
      otras: encima.length - 1,
    });
  }, [pendiente, flexEncendida, avisoServidor, horariosFlexibles, state.appointments, state.timezone]);

  // La rejilla que se DIBUJA: la hora redondeada y el tope de abajo salen de
  // ella, igual que en la agenda de siempre salen de la suya.
  const ventana = useMemo(
    () => ventanaDeRejilla(state.dayStart, state.dayEnd),
    [state.dayStart, state.dayEnd],
  );

  const planear = useCallback(
    (event: DragMoveEvent | DragEndEvent): DestinoArrastre | null => {
      const { active, over, delta } = event;
      if (!over) return null;
      const drag = active.data.current as AppointmentDragData | undefined;
      if (!drag || drag.kind !== "appt") return null;
      const target = over.data.current as DroppableData | undefined;
      if (!target) return null;
      const original = state.appointments.find((a) => a.id === drag.appointmentId);
      if (!original) return null;
      return {
        target,
        plan: planReschedule({
          original,
          target,
          deltaY: delta.y,
          slotHpx: altoDeHueco(state.slotMinutes),
          slotMinutes: state.slotMinutes,
          dayStart: ventana.horaInicio,
          dayEnd: ventana.horaFin,
          currentDayISO: state.dayISO,
          timezone: state.timezone,
          appointments: state.appointments,
        }),
      };
    },
    [state.appointments, state.slotMinutes, state.dayISO, state.timezone, ventana],
  );

  const alEmpezar = useCallback((event: DragStartEvent) => {
    const drag = event.active.data.current as AppointmentDragData | undefined;
    setCitaArrastrada(drag?.kind === "appt" ? drag.appointmentId : null);
    setDestino(null);
  }, []);

  const alMover = useCallback(
    (event: DragMoveEvent) => {
      const nuevo = planear(event);
      // Solo cuando cambia el hueco, la columna o el choque: no en cada píxel.
      setDestino((prev) => (mismoDestino(prev, nuevo) ? prev : nuevo));
    },
    [planear],
  );

  const limpiar = useCallback(() => {
    setCitaArrastrada(null);
    setDestino(null);
  }, []);

  const alSoltar = useCallback(
    (event: DragEndEvent) => {
      const d = planear(event);
      limpiar();
      if (!d) return;
      // La tarjeta ya nace sin arrastre si falta el permiso; esto es el
      // cinturón, y lo dice en vez de no hacer nada.
      if (!permissions.canEdit) {
        toast.error("No tienes permiso para mover citas.");
        return;
      }
      if (d.plan.unchanged) return;
      // WS1-T5 — con la bandera, el choque se pregunta en la ventana de mover.
      if (d.plan.overlap && !flexEncendida) {
        toast.error("Ahí ya hay otra cita del mismo doctor o de la misma unidad. La cita no se movió.");
        return;
      }
      setAvisoServidor(null);
      setPendiente(d.plan);
    },
    [planear, limpiar, permissions.canEdit, flexEncendida],
  );

  // Mientras se arrastra, el cursor dice «agarrado» en toda la pantalla.
  useEffect(() => {
    if (!citaArrastrada) return;
    const antes = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = antes;
    };
  }, [citaArrastrada]);

  const cancelar = useCallback(() => {
    if (guardando) return;
    setPendiente(null);
    setAvisoServidor(null);
  }, [guardando]);

  const confirmar = useCallback(async (aviso: { notifyPatient?: false } = {}) => {
    if (!pendiente || guardando) return;
    const plan = pendiente;
    setGuardando(true);
    try {
      // «Ya lo confirmé», solo si de verdad hay un bloqueo en el destino: el
      // aviso que la persona acaba de leer en la ventana de confirmar.
      const r = await commitReschedule(plan, {
        dispatch,
        bloqueoConfirmado: bloqueoDelDestino !== null,
        // ws1-t1 (F14): «Avisar al paciente» desmarcada en la ventana de confirmar.
        ...aviso,
        // WS1-T5 — solo si la ventana enseñaba el «¿Seguro?» de sobreagendar,
        // con la cita que enseñaba (el servidor no acepta otra).
        sobreagendar: sobreagendaDelDestino
          ? { citaId: sobreagendaDelDestino.citaId, otras: sobreagendaDelDestino.otras }
          : null,
      });
      // WS1-T5 — el servidor vio un choque que la pantalla no tenía cargado:
      // la cita ya volvió a su sitio; la misma ventana pregunta «¿Seguro?».
      const avisoRecibido =
        !r.ok
          ? avisoDesdeRechazo(
              r.error,
              { doctorId: plan.newDoctorId ?? plan.original.doctor?.id ?? null, resourceId: plan.newResourceId },
              state.timezone,
            )
          : null;
      // Ya confirmado y el servidor insiste con LA MISMA = no hay nada nuevo
      // que preguntar (se cuenta como rechazo). Con otra cita, se pregunta.
      const yaConfirmado = sobreagendaDelDestino;
      const avisoNuevo =
        avisoRecibido &&
        !(yaConfirmado && avisoRecibido.citaId === yaConfirmado.citaId && avisoRecibido.otras <= yaConfirmado.otras)
          ? avisoRecibido
          : null;
      if (avisoNuevo) {
        setAvisoServidor(avisoNuevo);
        return;
      }
      if (r.ok) {
        // Fuera de horario o en día cerrado el servidor guarda y AVISA (P1-13).
        if (r.scheduleWarning?.message) toast(r.scheduleWarning.message, { duration: 6000 });
        setAvisoServidor(null);
        // Igual que la agenda de siempre: sin router.refresh(), que rehidrata
        // con datos viejos y pisa el cambio; basta con vaciar la caché.
        invalidateRangeCache();
        toast.success("Cita movida");
        setPendiente(null);
        // La agenda de siempre aquí saltaba al día de destino (`setDay`). En la
        // nueva no hace falta: solo se suelta sobre columnas que ya están en
        // pantalla, y navegar recargaría la semana con un único día mientras
        // llega el rango.
      } else {
        // `commitReschedule` ya la devolvió a su sitio. Aquí se dice por qué.
        const unidad = state.resources.find((u) => u.id === plan.newResourceId);
        toast.error(mensajeDeRechazo(r.error, { plan, nombreUnidad: unidad?.name ?? null }), {
          duration: 7000,
        });
        setPendiente(null);
        // Sin conexión o con un error del servidor no se sabe si llegó a
        // guardarse: se vuelven a leer las citas de la vista para que la
        // pantalla enseñe lo que hay en la base y no lo que supone. Con
        // `refetchView` y no `router.refresh()`: éste rehidrata con la SSR de
        // un solo día y en Semana dejaría la vista recortada.
        if (rechazoIncierto(r.error)) refetchView();
      }
    } finally {
      setGuardando(false);
    }
  }, [
    pendiente,
    guardando,
    dispatch,
    invalidateRangeCache,
    refetchView,
    state.resources,
    state.timezone,
    bloqueoDelDestino,
    sobreagendaDelDestino,
  ]);

  const valor = useMemo<ArrastreValor>(
    () => ({ citaArrastrada, destino }),
    [citaArrastrada, destino],
  );

  return (
    <Ctx.Provider value={valor}>
      <DndContext
        // Id fijo: los atributos accesibles que dnd-kit numera salen iguales
        // en el servidor y en el navegador.
        id="agenda-nueva-arrastre"
        accessibility={{ announcements: AVISOS_LECTOR, screenReaderInstructions: INSTRUCCIONES_LECTOR }}
        sensors={sensores}
        collisionDetection={destinoBajoPuntero}
        onDragStart={alEmpezar}
        onDragMove={alMover}
        onDragEnd={alSoltar}
        onDragCancel={limpiar}
      >
        {children}
      </DndContext>
      {pendiente && (
        <ConfirmarMovimiento
          plan={pendiente}
          guardando={guardando}
          onConfirmar={confirmar}
          onCancelar={cancelar}
          // ⚠ El aviso va DENTRO de esta ventana y no en una segunda encima
          // (WS1-T3): soltar una cita ya abre una confirmación, y encadenar
          // dos para un solo gesto se convierte en dos «aceptar» seguidos que
          // nadie lee. Aquí el aviso está donde ya se está mirando, y
          // «Cancelar» sigue dejando la cita EXACTAMENTE donde estaba: el
          // movimiento optimista vive dentro de `commitReschedule`, que solo
          // corre al confirmar.
          bloqueo={bloqueoDelDestino}
          diaDestino={diaEnTz(pendiente.newStartsAt, state.timezone)}
          sobreagenda={sobreagendaDelDestino}
        />
      )}
    </Ctx.Provider>
  );
}

/**
 * WS1-T5 — las citas vivas del mismo doctor (o del mismo sillón) que pisan el
 * destino, también las sobreagendadas, de la que empieza antes a la última.
 * Mismo criterio que `buscarChoqueDeCita` del servidor (la primera se nombra,
 * el resto se cuenta), sobre lo que la pantalla tiene cargado.
 */
function choquesEnPantalla(
  plan: PlannedReschedule,
  doctorId: string,
  citas: readonly AgendaAppointmentDTO[],
): AgendaAppointmentDTO[] {
  const desde = new Date(plan.newStartsAt).getTime();
  const hasta = new Date(plan.newEndsAt).getTime();
  return citas
    .filter((c) => {
      if (c.id === plan.original.id) return false;
      if (c.status === "CANCELLED" || c.status === "NO_SHOW") return false;
      const ini = new Date(c.startsAt).getTime();
      const fin = c.endsAt ? new Date(c.endsAt).getTime() : ini;
      if (!(ini < hasta && fin > desde)) return false;
      return c.doctor?.id === doctorId || (!!plan.newResourceId && c.resourceId === plan.newResourceId);
    })
    // Mismo orden que el servidor: hora y, a la misma hora, id.
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

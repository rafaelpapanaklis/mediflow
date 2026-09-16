/**
 * Agendar con un clic y mover arrastrando, en la agenda nueva: las cuentas y
 * los textos, sin React.
 *
 * ⛔ Aquí NO hay reglas de agendar. Qué hora cae, con qué doctor, si choca,
 * qué se guarda y cómo se deshace lo decide lo mismo que en la agenda de
 * siempre:
 *   · el clic redondea con `slotFromOffsetY` (`hover-slot.ts`), la misma
 *     cuenta que `AgendaColumn.handleClick`;
 *   · el arrastre planea y guarda con `reschedule-flow.ts`, que es el código
 *     que ya usaba `AgendaShell`, sacado de ahí para que lo usen las dos;
 *   · la ventana de «Nueva cita» valida lo suyo, y el servidor, todo.
 *
 * Lo que sí es de aquí es de PANTALLA: en qué huecos se acepta un clic (el
 * diseño raya el cierre y el día cerrado, y eso no debe aceptar clics) y cómo
 * se le cuenta a la persona que el servidor dijo que no.
 *
 * 🔴 Todo minuto es hora de pared EN LA ZONA DE LA CLÍNICA.
 */

import { NOT_MOVABLE_STATUSES, bookingRuleMessage } from "@/lib/agenda/booking-rules";
import { describeOverlapConflict, describeResourceUnavailable } from "@/lib/agenda/conflict-copy";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";
import { slotFromOffsetY } from "@/lib/agenda/hover-slot";
import type { ApiError } from "@/lib/agenda/mutations";
import { optimisticDoctorIdOf, type ReschedulePlan } from "@/lib/agenda/reschedule-flow";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import { estadoNormalizado } from "./estados";
import { ALTO_HORA } from "./tokens";

/** Alto de un hueco de la clínica en la cuadrícula nueva (112 px por hora). */
export function altoDeHueco(slotMinutes: number): number {
  const paso = Number.isFinite(slotMinutes) && slotMinutes > 0 ? slotMinutes : 30;
  return (ALTO_HORA * paso) / 60;
}

/**
 * La hora que propone un clic en la cuadrícula, en minutos del día.
 *
 * Mismo criterio que la agenda de siempre: el hueco EN el que cae el clic,
 * redondeado hacia abajo al paso de la clínica. Con huecos de 15 min, un clic
 * a las 10:07 propone las 10:00 y uno a las 10:16, las 10:15.
 *
 * `y` es la distancia desde el techo del lienzo (la primera hora de la rejilla).
 */
export function inicioDeClic(args: {
  y: number;
  altoLienzo: number;
  slotMinutes: number;
  minutoInicio: number;
}): number {
  const paso = args.slotMinutes > 0 ? args.slotMinutes : 30;
  const hueco = slotFromOffsetY(args.y, altoDeHueco(paso), args.altoLienzo);
  return args.minutoInicio + hueco * paso;
}

/** Lo que la cuadrícula sabe de una columna para decidir si acepta el clic. */
export interface FranjasColumna {
  /** Día cerrado entero (rayado de arriba abajo). */
  cerrada?: boolean;
  /** Minuto en que abre: antes, rayado. */
  aperturaHastaMin?: number | null;
  /** Minuto en que cierra: desde ahí, rayado. */
  cierreDesdeMin?: number | null;
}

/**
 * ¿Se puede agendar con un clic a esta hora en esta columna?
 *
 * No en un día cerrado, ni antes de abrir, ni desde la hora de cierre: las
 * franjas que el diseño pinta a rayas. Un hueco que EMPIEZA antes del cierre
 * sí vale aunque la cita termine después; eso ya lo avisa el servidor.
 *
 * Es de pantalla, no una regla: el servidor sigue aceptando (y avisando) una
 * cita fuera de horario creada desde la ventana.
 */
export function aceptaClic(inicioMin: number, franjas: FranjasColumna): boolean {
  if (franjas.cerrada) return false;
  if (typeof franjas.aperturaHastaMin === "number" && inicioMin < franjas.aperturaHastaMin) return false;
  if (typeof franjas.cierreDesdeMin === "number" && inicioMin >= franjas.cierreDesdeMin) return false;
  return true;
}

/** En Semana cada día se reparte en carriles: el del punto donde cayó el clic. */
export function carrilDeClic(fraccionX: number, carriles: number): number {
  if (!(carriles > 0)) return 0;
  const i = Math.floor(fraccionX * carriles);
  return Math.max(0, Math.min(carriles - 1, i));
}

/**
 * ¿Se puede arrastrar esta cita? Los mismos tres estados con los que la
 * tarjeta de la agenda de siempre deshabilita el arrastre (y que el servidor
 * rechaza), y nunca sin permiso de editar.
 */
export function citaArrastrable(dto: Pick<AgendaAppointmentDTO, "status">, puedeEditar: boolean): boolean {
  if (!puedeEditar) return false;
  const estado = estadoNormalizado(dto.status);
  return !(NOT_MOVABLE_STATUSES as readonly string[]).includes(estado);
}

/** `10:30–11:15`, en la zona de la clínica. */
export function rangoDePlan(plan: Pick<ReschedulePlan, "newStartsAt" | "newEndsAt">, timezone: string): string {
  return `${formatTimeInTz(plan.newStartsAt, timezone)}–${formatTimeInTz(plan.newEndsAt, timezone)}`;
}

function esApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && typeof (e as ApiError).status === "number";
}

/**
 * ¿Es un rechazo del que NO se sabe si la cita se guardó?
 *
 * Un 4xx es un «no» del servidor: no guardó nada. Pero si se cortó la red, la
 * petición pudo llegar y guardarse aunque la respuesta se perdiera; y un 5xx
 * puede saltar después de guardar (p. ej. al anotar la bitácora). En esos
 * casos la vuelta atrás de la pantalla puede no coincidir con la base, así que
 * hay que volver a leer la agenda en vez de afirmar dónde quedó.
 */
export function rechazoIncierto(error: unknown): boolean {
  return !esApiError(error) || error.status >= 500;
}

/**
 * Por qué no se movió la cita, dicho para quien está en recepción.
 *
 * La agenda de siempre caía en «No se pudo reprogramar la cita» para todo lo
 * que no fuera un choque o una regla de agenda — incluido quedarse sin
 * permiso. Aquí cada rechazo del PATCH dice lo suyo. Los textos de choque y de
 * reglas son los MISMOS de siempre (`describeOverlapConflict`,
 * `bookingRuleMessage`, `describeResourceUnavailable`).
 */
export function mensajeDeRechazo(
  error: unknown,
  ctx: { plan: ReschedulePlan; nombreUnidad?: string | null },
): string {
  const vuelta = "La cita sigue en su hora de antes.";

  if (rechazoIncierto(error)) {
    return "No se pudo confirmar si la cita se movió. Se vuelve a cargar la agenda para ver dónde quedó.";
  }
  // (No llega aquí: lo cubre `rechazoIncierto`. Va para que TypeScript sepa
  // que de aquí abajo `error` es un `ApiError`.)
  if (!esApiError(error)) return `No se pudo mover la cita. ${vuelta}`;

  if (error.error === "appointment_overlap") {
    return describeOverlapConflict(error.conflictingAppointment, {
      doctorId: optimisticDoctorIdOf(ctx.plan),
      resourceId: ctx.plan.newResourceId,
    });
  }

  const regla = bookingRuleMessage(error);
  if (regla) return regla;

  if (error.status === 403) {
    if (error.error === "not_your_appointment") {
      return `Solo puedes mover tus propias citas. ${vuelta}`;
    }
    return `No tienes permiso para mover citas. Pídeselo a quien administra la clínica. ${vuelta}`;
  }

  if (error.error === "resource_unavailable") {
    const reason =
      error.reason === "outside_schedule" || error.reason === "resource_closed_this_day"
        ? error.reason
        : undefined;
    return describeResourceUnavailable(reason, ctx.nombreUnidad ?? null);
  }

  if (error.error === "doctor_not_found") {
    return `Ese doctor ya no está activo en la clínica. ${vuelta}`;
  }
  if (error.error === "resource_not_found") {
    return `Esa unidad ya no está activa. ${vuelta}`;
  }
  if (error.status === 404) {
    return `Esta cita ya no existe o ya no tienes acceso a ella. Recarga la agenda.`;
  }

  return `No se pudo mover la cita. ${vuelta}`;
}

/**
 * DaleControl INSTITUCIONAL — LA REJILLA de la agenda, sin base de datos.
 *
 * Módulo PURO y client-safe. Aquí vive TODO lo que la rejilla necesita
 * calcular; los componentes solo pintan. Y casi nada de lo que hay abajo es
 * código nuevo: el motor de la agenda del producto dental ya resolvió estos
 * problemas y se IMPORTA tal cual.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE IMPORTA DEL DENTAL (y por qué no se copia)
 *
 *   · `lane-layout`  → los CARRILES de las citas encimadas. Es el mismo
 *     algoritmo de Google Calendar que ya está probado allá.
 *   · `clinic-hours` → `paintedAgendaWindow`: el eje pinta el horario REAL
 *     y se ENSANCHA hasta cubrir cualquier cita que se salga de él. Una
 *     cita fuera de horario EXISTE (el alta la avisa, no la bloquea) y un
 *     eje estrecho la escondería.
 *   · `slot-metrics` → el alto del renglón y el zoom.
 *   · `drag-utils`   → píxeles arrastrados ⇄ renglones, y el choque en el
 *     navegador ANTES de molestar al servidor.
 *   · `doctor-color` → la paleta y la tinta legible encima de ella.
 *   · `time-utils`   → nada de zonas a mano.
 *
 * ⛔ Esos módulos NO se editan. Cuando algo no encaja, la adaptación va
 * AQUÍ — que es lo que hacen las tres funciones de traducción de abajo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 AQUÍ NO SE FORMATEA UNA HORA CON LA ZONA DEL NAVEGADOR.
 *
 * Las etiquetas ("08:30") vienen del servidor en la hora del INSTITUTO, y
 * las que esta pantalla genera (el badge que sigue al dedo mientras se
 * arrastra) salen de `eduMinutesToLabel`, que convierte un ENTERO en texto
 * y no sabe lo que es una zona horaria. La posición de una tarjeta en la
 * rejilla también es aritmética de minutos de pared: si dependiera de la
 * zona del dispositivo, un estudiante conectado desde otra ciudad vería sus
 * citas movidas y el primer render no coincidiría con el del servidor.
 *
 * La ÚNICA conversión con zona que ocurre en el navegador es la del choque
 * (`eduAgendaConflicto`): compara instantes, y para eso hace falta un
 * instante. Usa la zona del INSTITUTO que manda el servidor, nunca la del
 * dispositivo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { assignLanes } from "@/lib/agenda/lane-layout";
import { paintedAgendaWindow, type ScheduleDay } from "@/lib/agenda/clinic-hours";
import {
  DEFAULT_SLOT_HPX,
  slotHeightFor,
  showHalfHourLabels,
  CARD_TWO_ROW_MIN_PX,
} from "@/lib/agenda/slot-metrics";
import { deltaYToSlots, detectOverlap } from "@/lib/agenda/drag-utils";
import { doctorColorFor, doctorInitials, readableTextOn } from "@/lib/agenda/doctor-color";
import type { AgendaAppointmentDTO, AgendaDensity } from "@/lib/agenda/types";
import {
  EDU_MINUTES_IN_DAY,
  eduFormatDayShort,
  eduMinutesToLabel,
  eduWeekdayOf,
  eduZonedToUtc,
  parseEduMinuteOfDay,
  type EduAgendaQuery,
  type EduAgendaView,
  type EduAppointmentRow,
} from "@/lib/edu/agenda-core";
import type { EduAppointmentStatus } from "@/lib/edu/types";

export { DEFAULT_SLOT_HPX, slotHeightFor, showHalfHourLabels, CARD_TWO_ROW_MIN_PX };
export type { AgendaDensity as EduAgendaDensity };

// ═══════════════════════════════════════════════════════════════════════
// 0 · CONSTANTES DE LA REJILLA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El renglón de la rejilla mide 15 minutos, igual que en el dental.
 *
 * No es el paso de las citas (una cita del instituto puede durar 10, 45 o
 * 90 minutos): es la RESOLUCIÓN a la que se arrastra. Una tarjeta se pinta
 * con su duración exacta —en renglones fraccionarios— y al soltarla su hora
 * cae en el cuarto de hora más cercano, que es como se reparte una clínica.
 */
export const EDU_AGENDA_SLOT_MINUTES = 15;

/**
 * El lienzo cuando NINGÚN sillón visible tiene horario capturado.
 *
 * Un sillón sin filas de horario está SIEMPRE ABIERTO (regla de la Ola 2, y
 * no se toca), así que no hay de dónde deducir un horario: se pinta la
 * jornada de siempre y las citas la ensanchan si hace falta. Mismo 8–20 que
 * el dental usa como suelo.
 */
export const EDU_AGENDA_DEFAULT_WINDOW = { dayStart: 8, dayEnd: 20 } as const;

/** El zoom, con el nombre que se lee en pantalla. */
export const EDU_AGENDA_DENSITIES: AgendaDensity[] = ["fit", "medium", "spacious"];

export const EDU_AGENDA_DENSITY_LABELS: Record<AgendaDensity, string> = {
  fit: "Todo el día",
  medium: "Media",
  spacious: "Amplia",
};

export const EDU_AGENDA_DENSITY_HINTS: Record<AgendaDensity, string> = {
  fit: "La jornada completa cabe en pantalla, sin desplazar.",
  medium: "Renglones de 20 px: más detalle, con desplazamiento.",
  spacious: "Renglones de 30 px: el máximo detalle.",
};

/**
 * Renglón mínimo del preset "Todo el día".
 *
 * 🔴 NO es el `FIT_MIN_SLOT_HPX` del dental (10 px), y la diferencia no es
 * un capricho: allá el piso está puesto para que el TEXTO DE LAS TARJETAS
 * siga siendo legible y se acepta que reaparezca el desplazamiento; aquí el
 * preset PROMETE que el día entero cabe sin desplazar, y con 10 px una
 * jornada de 12 h (48 renglones = 480 px) no cabía en el hueco real que le
 * queda a la rejilla —medido: 416 px en 1366×768 y 349 px en un teléfono—,
 * así que se comía las últimas seis horas SIN dejar bajar a verlas.
 *
 * 5 px por renglón = 20 px de banda por hora. El número sale de MEDIR, no
 * de la intuición: el rótulo del eje ocupa 12 px de caja (12 px de letra
 * con `line-height: 1`, ver edu-theme.css), así que a 20 px por hora quedan
 * 8 px de aire entre una hora y la siguiente. Por debajo empiezan a
 * tocarse, y ahí sí vale más que vuelva el desplazamiento —que funciona—
 * que un eje ilegible: es el suelo, no el objetivo. Con él, una jornada de
 * 15 h entra en los 303 px que deja un teléfono de 390×844. El detalle
 * vive en "Media" y "Amplia".
 */
export const EDU_AGENDA_FIT_MIN_SLOT_HPX = 5;

/**
 * El alto del renglón, con el piso de arriba en vez del del dental.
 *
 * Para "Media" y "Amplia" delega en `slotHeightFor` tal cual (20 y 30 px):
 * las densidades fijas son las mismas y duplicar los números aquí sería
 * justo el bug que `slot-metrics` documenta.
 *
 * `disponiblePx` es el hueco REAL para los renglones: el alto acotado del
 * contenedor MENOS la fila de encabezados y los bordes. Si se le pasa el
 * alto entero, el día "que cabe" se pasa por el alto de la cabecera y la
 * última hora queda cortada.
 */
export function eduSlotHeightFor(
  density: AgendaDensity,
  disponiblePx: number | null,
  slotsTotal: number,
): number {
  if (density !== "fit") return slotHeightFor(density, null, slotsTotal);
  if (disponiblePx == null || disponiblePx <= 0 || slotsTotal <= 0) return DEFAULT_SLOT_HPX;
  return Math.max(EDU_AGENDA_FIT_MIN_SLOT_HPX, Math.floor(disponiblePx / slotsTotal));
}

/** Dónde se recuerda el zoom entre visitas. */
export const EDU_AGENDA_DENSITY_KEY = "edu-agenda-densidad";

export function parseEduAgendaDensity(raw: unknown): AgendaDensity | null {
  return typeof raw === "string" && (EDU_AGENDA_DENSITIES as string[]).includes(raw)
    ? (raw as AgendaDensity)
    : null;
}

/**
 * Ancho al que la vista de DÍA deja de caber en columnas.
 *
 * Se mide con `@container` sobre el envoltorio de la rejilla y NO con
 * `@media`: el panel del instituto tiene un cajón de menú que en escritorio
 * es una columna fija, así que el ancho de la VENTANA no es el ancho que le
 * queda a la agenda. El número viaja también en JS porque la decisión
 * "cuántas columnas pinto" no se puede tomar solo en CSS: con 32 sillones,
 * esconderlos con `display:none` dejaría 32 columnas montadas en el DOM.
 */
export const EDU_AGENDA_NARROW_PX = 640;

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL SILLÓN, COMO LO NECESITA LA REJILLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduAgendaChairSchedule {
  /** 0 = domingo … 6 = sábado (el convenio del vertical). */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Un sillón con lo que la rejilla necesita: identidad, sede y HORARIO.
 *
 * El horario es lo único que `EduChairOption` no traía, y es justo lo que
 * decide dónde empieza y dónde acaba el eje. Sin él, la agenda de una
 * escuela que abre a las 7 y cierra a las 21 pintaba 8–20 y escondía las
 * dos puntas del día.
 */
export interface EduAgendaChair {
  id: string;
  name: string;
  number: number;
  isActive: boolean;
  orderIndex: number;
  campusId: string;
  campusName: string;
  schedules: EduAgendaChairSchedule[];
}

/**
 * Los horarios de los sillones, en el formato que entiende `clinic-hours`
 * del dental.
 *
 * Dos traducciones, y las dos se equivocan solas si no están escritas en un
 * sitio:
 *   · el DÍA: el vertical usa 0=domingo…6=sábado (como `Date#getUTCDay`) y
 *     el dental 0=lunes…6=domingo. `(d + 6) % 7` pasa de uno al otro.
 *   · la HORA: aquí son minutos desde medianoche (480), allá texto "08:00".
 *
 * Se juntan los horarios de TODOS los sillones visibles y el motor se queda
 * con la unión (el que abre más temprano y el que cierra más tarde).
 *
 * 🔴 Un sillón SIN filas no aporta ninguna, y aquí eso NO significa que no
 * pase nada: está siempre abierto, así que lo que aporta lo pone
 * `eduAgendaWindow` con `eduJornadaAbierta`. Esta función es solo la
 * traducción de lo capturado; leerla sola engaña, porque un sillón sin
 * horario desaparecía del eje y terminaba con el de su vecino.
 */
export function eduChairScheduleDays(chairs: readonly EduAgendaChair[]): ScheduleDay[] {
  const out: ScheduleDay[] = [];
  for (const chair of chairs) {
    for (const s of chair.schedules ?? []) {
      if (!Number.isFinite(s.startMinute) || !Number.isFinite(s.endMinute)) continue;
      if (s.endMinute <= s.startMinute) continue;
      const weekday = Math.trunc(s.weekday);
      if (weekday < 0 || weekday > 6) continue;
      out.push({
        dayOfWeek: (weekday + 6) % 7,
        enabled: true,
        openTime: eduMinutesToLabel(s.startMinute),
        closeTime: eduMinutesToLabel(Math.min(s.endMinute, EDU_MINUTES_IN_DAY)),
      });
    }
  }
  return out;
}

/**
 * ¿Este sillón acepta CUALQUIER hora?
 *
 * Es la regla del servidor, con su mismo criterio (`eduScheduleAllows`:
 * `slots.length === 0` → true) y no una parecida: sin filas de horario el
 * sillón está SIEMPRE ABIERTO, y con una sola fila solo acepta lo que caiga
 * dentro de ella. Se cuentan las filas CRUDAS —no las válidas— justo para
 * no separarse del servidor: si el eje usara otro criterio, pintaría huecos
 * que el alta después rebota, o escondería huecos que sí acepta.
 */
export function eduChairSinHorario(chair: EduAgendaChair): boolean {
  return (chair.schedules ?? []).length === 0;
}

/**
 * Lo que un sillón SIN horario le aporta al eje: la jornada por defecto, en
 * cada uno de los días que se están pintando.
 *
 * 🔴 Sin esto, un sillón siempre abierto se quedaba con el eje del vecino.
 * El comentario de `eduChairScheduleDays` decía que un sillón sin filas "no
 * puede estrechar el eje de los demás", y era verdad al revés: no aportaba
 * nada, así que eran LOS DEMÁS los que se lo estrechaban a él. Con dos
 * sillones —uno con la franja 08:00–14:00 que el editor de Sillones trae
 * escrita por defecto y otro recién dado de alta— el eje se quedaba en seis
 * horas, y las tardes del sillón que SÍ acepta citas a las cuatro no se
 * podían ni ver ni tocar.
 */
function eduJornadaAbierta(visibleDays: readonly number[]): ScheduleDay[] {
  return visibleDays.map((dayOfWeek) => ({
    dayOfWeek,
    enabled: true,
    openTime: eduMinutesToLabel(EDU_AGENDA_DEFAULT_WINDOW.dayStart * 60),
    closeTime: eduMinutesToLabel(EDU_AGENDA_DEFAULT_WINDOW.dayEnd * 60),
  }));
}

/** Los días (0=lunes…6=domingo) que la vista pinta: uno en Día, siete en Semana. */
export function eduAgendaVisibleDays(view: EduAgendaView, days: readonly string[]): number[] {
  const fuente = view === "semana" ? days : days.slice(0, 1);
  const vistos = new Set<number>();
  for (const d of fuente) vistos.add((eduWeekdayOf(d) + 6) % 7);
  return Array.from(vistos);
}

/**
 * La ventana horaria que el EJE dibuja.
 *
 * Es `paintedAgendaWindow` del dental —horario real de los días visibles,
 * ensanchado hasta cubrir la cita más temprana y la más tardía del lote—
 * con UNA adaptación que el dental no necesita: allá la clínica es una y
 * tiene un horario; aquí cada SILLÓN tiene el suyo, y uno sin capturar
 * está siempre abierto. El eje es la UNIÓN de lo que aporta cada sillón
 * que se está pintando:
 *
 *   · con franjas ese día  → sus franjas, redondeadas a horas completas;
 *   · con franjas, pero NO ese día → nada (ese día está cerrado);
 *   · SIN franjas ningunas → la jornada por defecto, 08:00–20:00, porque
 *     acepta cualquier hora (ver `eduChairSinHorario`);
 *   · si al final no aporta nadie → la jornada por defecto también.
 *
 * Y encima de todo eso, las citas del día lo ensanchan: una cita a las 7:30
 * se VE aunque el sillón abra a las 8 (el alta AVISA, no bloquea).
 *
 * Solo presentación — nada de lo que LEE citas pasa por aquí (el rango de
 * lectura lo decide `eduDayRange` en el servidor, y estrecharlo dejaría de
 * traer filas).
 */
export function eduAgendaWindow(input: {
  chairs: readonly EduAgendaChair[];
  rows: readonly EduAppointmentRow[];
  view: EduAgendaView;
  days: readonly string[];
  timezone: string;
}): { dayStart: number; dayEnd: number } {
  const { chairs, rows, view, days, timezone } = input;
  const visibleDays = eduAgendaVisibleDays(view, days);
  const capturados = eduChairScheduleDays(chairs);
  const hayAbierto = chairs.some(eduChairSinHorario);
  return paintedAgendaWindow({
    fallback: EDU_AGENDA_DEFAULT_WINDOW,
    schedules: hayAbierto ? [...capturados, ...eduJornadaAbierta(visibleDays)] : capturados,
    visibleDays,
    appointments: rows.map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt })),
    onlyDayISO: view === "semana" ? null : (days[0] ?? null),
    timezone,
  });
}

/** Cuántos renglones de 15 minutos tiene la ventana pintada. */
export function eduAgendaSlots(window: { dayStart: number; dayEnd: number }): number {
  return Math.max(1, Math.round(((window.dayEnd - window.dayStart) * 60) / EDU_AGENDA_SLOT_MINUTES));
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · DÓNDE CAE UNA CITA EN LA REJILLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduAgendaPlacement {
  /** Minuto de pared en que empieza (480 = 08:00), en la hora del instituto. */
  startMinute: number;
  endMinute: number;
  /** Renglones desde el borde de arriba de la ventana pintada. Fraccionario. */
  topSlots: number;
  /** Alto en renglones. Fraccionario, con un piso para que se pueda tocar. */
  spanSlots: number;
  /** true = la cita se sale por abajo de la medianoche y se recortó. */
  clipped: boolean;
}

/**
 * El minuto de pared en que empieza una cita.
 *
 * Sale de la ETIQUETA que ya calculó el servidor ("08:30") y no de un
 * `new Date(row.startsAt)`: la etiqueta está en la hora del INSTITUTO y el
 * `Date` la daría en la del dispositivo. Es la misma razón por la que esta
 * pantalla no formatea horas — solo que aquí el síntoma sería peor: la
 * tarjeta se pintaría a una altura que no coincide con su propio rótulo.
 */
export function eduRowStartMinute(row: Pick<EduAppointmentRow, "startLabel">): number {
  return parseEduMinuteOfDay(row.startLabel) ?? 0;
}

/**
 * Alto y posición de una tarjeta.
 *
 * La duración manda `minutes` (que el servidor calculó restando instantes),
 * no la resta de las dos etiquetas: una cita que cruza la medianoche
 * terminaría con una etiqueta MENOR que la de inicio y saldría con alto
 * negativo. Cuando eso pasa se recorta a la medianoche y se marca
 * `clipped`, para que la tarjeta lo pueda decir en vez de mentir.
 */
export function eduRowPlacement(
  row: Pick<EduAppointmentRow, "startLabel" | "minutes">,
  window: { dayStart: number; dayEnd: number },
): EduAgendaPlacement {
  const startMinute = eduRowStartMinute(row);
  const duracion = Math.max(1, Math.trunc(row.minutes) || 0);
  const finCrudo = startMinute + duracion;
  const endMinute = Math.min(finCrudo, EDU_MINUTES_IN_DAY);
  const topSlots = (startMinute - window.dayStart * 60) / EDU_AGENDA_SLOT_MINUTES;
  const spanSlots = Math.max(
    // Media franja de piso: una cita de 10 minutos con el zoom en "todo el
    // día" mediría 6 px y no habría dónde tocarla.
    0.5,
    (endMinute - startMinute) / EDU_AGENDA_SLOT_MINUTES,
  );
  return { startMinute, endMinute, topSlots, spanSlots, clipped: finCrudo > EDU_MINUTES_IN_DAY };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA TRADUCCIÓN AL MOTOR DEL DENTAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Una cita del instituto, con la forma que esperan `lane-layout` y
 * `drag-utils`.
 *
 * Las dos correspondencias que importan, y que NO son arbitrarias:
 *   · el SILLÓN es el "recurso" — dos citas no caben en el mismo a la vez;
 *   · el ESTUDIANTE es el "doctor" — tampoco puede estar en dos sillones a
 *     la vez.
 * Con eso, el `detectOverlap` del dental comprueba en el navegador
 * EXACTAMENTE las dos colisiones que el servidor comprueba en la base
 * (`assertNoClash`): sillón ocupado y estudiante ocupado. Si la
 * correspondencia fuera otra, el aviso del arrastre diría verde donde el
 * servidor va a decir que no.
 *
 * Los siete estados del instituto son un subconjunto de los del dental
 * (allá hay además CONFIRMED y CHECKED_OUT), así que el estado viaja tal
 * cual y las canceladas se descartan solas donde toca.
 */
export function eduRowToAgendaDTO(row: EduAppointmentRow): AgendaAppointmentDTO {
  return {
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    patient: { id: row.patientId, name: row.patientName },
    doctor: { id: row.studentId, shortName: row.studentName },
    resourceId: row.chairId,
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
  };
}

export interface EduAgendaLane {
  lane: number;
  laneCount: number;
}

/**
 * Los CARRILES de un grupo de citas encimadas.
 *
 * 🔴 Se calculan con TODAS las filas que están en pantalla, incluidas las
 * canceladas y las que no llegaron. `assignLanes` las descarta —allá una
 * cancelada no ocupa espacio porque no se pinta— y aquí SÍ se pintan (una
 * cancelada es información: ese hueco se liberó). Sin este ajuste, la
 * cancelada tomaba el ancho completo de la columna y tapaba a la cita que
 * de verdad está ocupando el sillón.
 *
 * El choque es otra pregunta y se contesta con el estado REAL: ver
 * `eduAgendaConflicto`. Una cancelada ocupa PÍXELES pero no ocupa SILLÓN.
 */
export function eduAgendaLanes(rows: readonly EduAppointmentRow[]): Map<string, EduAgendaLane> {
  const paraCarriles = rows.map((r) => ({
    ...eduRowToAgendaDTO(r),
    status: "SCHEDULED" as EduAppointmentStatus,
  }));
  const out = new Map<string, EduAgendaLane>();
  for (const slot of assignLanes(paraCarriles, EDU_AGENDA_SLOT_MINUTES)) {
    out.set(slot.appt.id, { lane: slot.lane, laneCount: slot.laneCount });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LAS COLUMNAS
// ═══════════════════════════════════════════════════════════════════════

export type EduAgendaColumnKind = "chair" | "day";

export interface EduAgendaColumn {
  key: string;
  kind: EduAgendaColumnKind;
  /** "Sillón 3" en Día; "lun 31 ago" en Semana. */
  title: string;
  /** La sede, "Hoy", "Dado de baja"… lo que haga falta y nada más. */
  sub: string;
  chairId: string | null;
  dayISO: string | null;
  rows: EduAppointmentRow[];
}

export interface EduAgendaLayout {
  columns: EduAgendaColumn[];
  /** La ventana que el eje pinta. */
  window: { dayStart: number; dayEnd: number };
  /** Sillones que existen y NO se están pintando (móvil, o filtro puesto). */
  hiddenChairs: number;
  /** Citas que no caben en ninguna columna pintada. */
  hiddenRows: number;
  /** ¿Hay más de una sede entre los sillones? Decide si se nombra. */
  variasSedes: boolean;
}

/**
 * VISTA DÍA = una columna por SILLÓN. Es el piso de la clínica visto desde
 * arriba, que es como la escuela reparte el trabajo: "el 12 está libre a
 * las once". VISTA SEMANA = una columna por día, como en el dental.
 *
 * En Día se pintan los sillones ACTIVOS más los que tengan citas aunque
 * estén de baja: una cita en un sillón dado de baja existe y esconderla
 * dejaría a un paciente citado que nadie ve. Y si alguna cita apunta a un
 * sillón que ni siquiera está en la lista (se dio de baja y se borró de los
 * desplegables), va a una columna "Otros sillones" — el mismo cinturón que
 * tenía la pantalla de lista.
 *
 * `soloUno` es la vista de teléfono: ver abajo, en la nota de la pantalla
 * angosta.
 */
export function eduAgendaLayout(input: {
  rows: readonly EduAppointmentRow[];
  chairs: readonly EduAgendaChair[];
  query: EduAgendaQuery;
  days: readonly string[];
  todayISO: string;
  timezone: string;
  /** true = solo cabe una columna (teléfono). */
  soloUno: boolean;
}): EduAgendaLayout {
  const { rows, chairs, query, days, todayISO, timezone, soloUno } = input;
  const window = eduAgendaWindow({ chairs, rows, view: query.view, days, timezone });
  const variasSedes = new Set(chairs.map((c) => c.campusId)).size > 1;

  if (query.view === "semana") {
    return {
      window,
      variasSedes,
      hiddenChairs: 0,
      hiddenRows: 0,
      columns: days.map((d) => ({
        key: d,
        kind: "day" as const,
        title: eduFormatDayShort(d),
        sub: d === todayISO ? "Hoy" : "",
        chairId: null,
        dayISO: d,
        rows: rows.filter((r) => r.dayISO === d),
      })),
    };
  }

  const conCitas = new Set(rows.map((r) => r.chairId));
  const visibles = chairs.filter((c) => c.isActive || conCitas.has(c.id));
  const filtrados = query.chairId ? visibles.filter((c) => c.id === query.chairId) : visibles;
  // En el teléfono se pinta UNA sola columna: la del filtro si lo hay, y si
  // no la primera del piso. No se inventa estado — cuál se ve lo sigue
  // decidiendo `?sillon=`, y la pantalla lo DICE.
  const pintados = soloUno ? filtrados.slice(0, 1) : filtrados;

  const columns: EduAgendaColumn[] = pintados.map((c) => ({
    key: c.id,
    kind: "chair" as const,
    title: c.name,
    sub: [variasSedes ? c.campusName : "", c.isActive ? "" : "Dado de baja"]
      .filter(Boolean)
      .join(" · "),
    chairId: c.id,
    dayISO: days[0] ?? null,
    rows: rows.filter((r) => r.chairId === c.id),
  }));

  const enColumna = new Set(pintados.map((c) => c.id));
  const sueltas = rows.filter((r) => !enColumna.has(r.chairId));
  // La columna de recogida solo aparece cuando se están pintando TODOS los
  // sillones: con un filtro puesto (o en el teléfono) las que quedan fuera
  // no son huérfanas, son las que el filtro dejó fuera a propósito.
  const recoger = !query.chairId && !soloUno && sueltas.length > 0;
  if (recoger) {
    columns.push({
      key: "edu-ag-sueltas",
      kind: "chair",
      title: "Otros sillones",
      sub: "Dados de baja",
      chairId: null,
      dayISO: days[0] ?? null,
      rows: sueltas,
    });
  }

  return {
    window,
    variasSedes,
    columns,
    hiddenChairs: Math.max(0, visibles.length - pintados.length),
    hiddenRows: recoger ? 0 : sueltas.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL COLOR ES DE LA ESPECIALIDAD, NO DE LA PERSONA
// ═══════════════════════════════════════════════════════════════════════

/**
 * En el dental el color es del DOCTOR y funciona: una clínica tiene seis.
 * Una escuela tiene ciento veinte estudiantes, y ciento veinte colores no
 * son un código, son ruido — dos tonos vecinos no se distinguen y la
 * leyenda no cabría en pantalla.
 *
 * Aquí el color es de la ESPECIALIDAD (el programa del estudiante que
 * atiende), que es la unidad con la que la escuela piensa el piso: "hoy
 * endodoncia tiene ocho sillones". Son entre tres y diez, se distinguen, y
 * la leyenda cabe arriba.
 *
 * El hash y la paleta son los del dental (`doctorColorFor`), así que un
 * mismo programa tiene siempre su color sin guardarlo en ninguna columna, y
 * la tinta encima la calcula `readableTextOn` — negro o blanco, el que
 * contraste, porque un color claro con letra blanca no se lee.
 */
export interface EduAgendaProgramColor {
  id: string;
  name: string;
  color: string;
  ink: string;
  initials: string;
}

export function eduProgramColor(id: string, name: string): EduAgendaProgramColor {
  const color = doctorColorFor(id);
  return { id, name, color, ink: readableTextOn(color), initials: doctorInitials(name) };
}

/**
 * La leyenda: qué especialidades hay que explicar.
 *
 * Lleva las del padrón MÁS las que tengan citas en el rango cargado aunque
 * ya no estén en la lista. Es la lección de la leyenda de doctores del
 * dental: todo color que se pinta necesita su entrada, o hay un color en
 * pantalla que nadie puede nombrar ni filtrar.
 */
export function eduAgendaLegend(
  programs: readonly { id: string; name: string }[],
  rows: readonly EduAppointmentRow[],
): (EduAgendaProgramColor & { count: number })[] {
  const conteo = new Map<string, number>();
  const nombres = new Map<string, string>();
  for (const p of programs) nombres.set(p.id, p.name);
  for (const r of rows) {
    conteo.set(r.studentProgramId, (conteo.get(r.studentProgramId) ?? 0) + 1);
    if (!nombres.has(r.studentProgramId)) nombres.set(r.studentProgramId, r.studentProgramName);
  }
  const orden = [
    ...programs.map((p) => p.id),
    ...Array.from(nombres.keys()).filter((id) => !programs.some((p) => p.id === id)),
  ];
  return orden.map((id) => ({
    ...eduProgramColor(id, nombres.get(id) ?? "Sin especialidad"),
    count: conteo.get(id) ?? 0,
  }));
}

/**
 * El punto de ESTADO. El color de la tarjeta ya está tomado por la
 * especialidad, así que el estado va donde va en el dental: un punto de 7 px
 * con el token fuerte del tema, que se adapta solo al modo oscuro.
 *
 * Es un `Record` COMPLETO del enum a propósito. Con un `switch` y un
 * `default`, un estado nuevo saldría pintado del color de relleno y nadie
 * se enteraría; así TypeScript se pone rojo el día que se agregue uno.
 */
export const EDU_AGENDA_STATUS_TONE: Record<EduAppointmentStatus, string> = {
  SCHEDULED: "agendada",
  CHECKED_IN: "llego",
  IN_CHAIR: "sillon",
  IN_PROGRESS: "curso",
  COMPLETED: "terminada",
  CANCELLED: "cancelada",
  NO_SHOW: "falto",
};

/** Los estados que ya no se mueven: ni se arrastran ni se reagendan. */
export function eduAgendaRowIsClosed(status: EduAppointmentStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "NO_SHOW";
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · ARRASTRAR PARA REAGENDAR
// ═══════════════════════════════════════════════════════════════════════

export interface EduAgendaDropInput {
  row: EduAppointmentRow;
  /** Píxeles arrastrados en vertical desde donde empezó. */
  deltaY: number;
  /** Alto REAL de un renglón. La misma fuente que pinta la rejilla. */
  slotHpx: number;
  window: { dayStart: number; dayEnd: number };
  /** La columna sobre la que se soltó. */
  target: { chairId: string | null; dayISO: string | null };
}

export interface EduAgendaDrop {
  dayISO: string;
  startMinute: number;
  minutes: number;
  chairId: string;
  /** "09:15" — lo que se enseña mientras se arrastra. Minutos → texto. */
  startLabel: string;
  endLabel: string;
  /** ¿De verdad cambió algo? Soltar donde estaba no es reagendar. */
  changed: boolean;
}

/**
 * Dónde cae la cita al soltarla.
 *
 * El delta de píxeles a renglones lo hace `deltaYToSlots` del dental —el
 * mismo redondeo, y sin ninguna constante de altura cableada aquí: el alto
 * del renglón se le PASA, porque cambia con el zoom. Un número fijo movería
 * las citas a la hora equivocada en cuanto alguien tocara la densidad, que
 * es exactamente el bug que allá costó arreglar.
 *
 * El resultado se acota a la ventana PINTADA: no se puede soltar una cita
 * donde no hay rejilla. Y se devuelve en hora de PARED (día + minuto), que
 * es justo lo que el endpoint de reagendar espera — sin pasar por un
 * instante, no hay forma de que la zona del navegador se cuele.
 */
export function eduAgendaDrop(input: EduAgendaDropInput): EduAgendaDrop | null {
  const { row, deltaY, slotHpx, window, target } = input;
  const chairId = target.chairId ?? row.chairId;
  const dayISO = target.dayISO ?? row.dayISO;
  if (!chairId || !dayISO) return null;

  const minutes = Math.max(1, Math.trunc(row.minutes) || 0);
  const inicioVentana = window.dayStart * 60;
  const finVentana = window.dayEnd * 60;
  const actual = eduRowStartMinute(row);

  const pasos = deltaYToSlots(deltaY, slotHpx);
  // 🔴 SE CONSERVA EL DESFASE de la cita: se le SUMAN cuartos de hora, no
  // se la realinea a la rejilla. Realineando, una cita de las 09:10 soltada
  // donde estaba se proponía a las 09:15 —un cambio de hora que nadie
  // pidió— y el diálogo de confirmar se abría por un simple clic.
  const crudo = actual + pasos * EDU_AGENDA_SLOT_MINUTES;
  // Dentro de lo PINTADO. El techo deja la cita ENTERA dentro: soltarla
  // pegada al borde de abajo la sacaría del eje.
  const techo = Math.max(inicioVentana, finVentana - minutes);
  const startMinute = Math.max(inicioVentana, Math.min(techo, crudo));

  return {
    dayISO,
    startMinute,
    minutes,
    chairId,
    startLabel: eduMinutesToLabel(startMinute),
    endLabel: eduMinutesToLabel(Math.min(startMinute + minutes, EDU_MINUTES_IN_DAY)),
    changed: startMinute !== actual || dayISO !== row.dayISO || chairId !== row.chairId,
  };
}

/**
 * ¿El destino choca con algo? Se pregunta ANTES de mandar nada, para que el
 * hueco se pinte rojo mientras el dedo sigue encima.
 *
 * Es `detectOverlap` del dental, con la correspondencia de arriba: el
 * sillón hace de recurso y el estudiante de doctor, así que comprueba las
 * dos colisiones que el servidor comprueba. NO sustituye al servidor —una
 * cita agendada por otra persona hace un segundo no está en este lote— y
 * por eso, cuando el servidor dice que no, la tarjeta vuelve a su sitio.
 *
 * Aquí SÍ se convierte a instantes (única conversión con zona del
 * navegador): las citas del lote traen instantes reales y comparar peras
 * con peras exige que las dos sean instantes. La zona es la del INSTITUTO,
 * que llega del servidor, nunca la del dispositivo.
 */
export function eduAgendaConflicto(input: {
  rows: readonly EduAppointmentRow[];
  row: EduAppointmentRow;
  drop: EduAgendaDrop;
  timezone: string;
}): boolean {
  const { rows, row, drop, timezone } = input;
  const inicio = eduZonedToUtc(drop.dayISO, drop.startMinute, timezone);
  if (!inicio) return false;
  const fin = new Date(inicio.getTime() + drop.minutes * 60_000);
  return detectOverlap(
    rows.map(eduRowToAgendaDTO),
    row.id,
    inicio.toISOString(),
    fin.toISOString(),
    row.studentId,
    drop.chairId,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · LO QUE VIAJA EN LA URL
//
// 🔴 LAS SIETE LLAVES QUE YA EXISTÍAN NO SE RENOMBRAN. Hay enlaces
// repartidos por el producto (y en los correos de la escuela) que las usan:
// `vista`, `dia`, `sillon`, `programa`, `alumno`, `tipo`, `estado`. Esta
// ola AÑADE dos —`docente` y `q`— y no toca ninguna de las viejas. Hay una
// prueba que lo fija, porque un renombre "que se ve mejor" es gratis de
// escribir y rompe enlaces que nadie puede arreglar.
// ═══════════════════════════════════════════════════════════════════════

export const EDU_AGENDA_URL_KEYS = [
  "vista",
  "dia",
  "sillon",
  "programa",
  "alumno",
  "tipo",
  "estado",
  "docente",
  "q",
  "modo",
] as const;

/** Las siete que YA EXISTÍAN antes de esta ola. Renombrar una rompe enlaces
 *  que nadie puede arreglar: hay una prueba que las fija una por una. */
export const EDU_AGENDA_URL_KEYS_HEREDADAS = [
  "vista",
  "dia",
  "sillon",
  "programa",
  "alumno",
  "tipo",
  "estado",
] as const;

export type EduAgendaUrlKey = (typeof EDU_AGENDA_URL_KEYS)[number];

/** La query de hoy, escrita como parámetros. Lo vacío no se escribe: una
 *  URL con `&tipo=` es una URL distinta para el mismo día. */
export function eduAgendaParams(
  query: EduAgendaQuery,
  next: Partial<Record<EduAgendaUrlKey, string>> = {},
): URLSearchParams {
  const actual: Record<EduAgendaUrlKey, string> = {
    vista: query.view,
    dia: query.dayISO,
    sillon: query.chairId ?? "",
    programa: query.programId ?? "",
    alumno: query.studentId ?? "",
    tipo: query.type ?? "",
    estado: query.status ?? "",
    docente: query.supervisorUserId ?? "",
    q: query.q ?? "",
    // "rejilla" es el default y no se escribe: una URL con `&modo=rejilla`
    // es otra URL para exactamente lo mismo.
    modo: query.mode === "lista" ? "lista" : "",
  };
  const params = new URLSearchParams();
  for (const key of EDU_AGENDA_URL_KEYS) {
    const value = key in next ? (next[key] ?? "") : actual[key];
    if (value) params.set(key, value);
  }
  return params;
}

export function eduAgendaHref(
  query: EduAgendaQuery,
  next: Partial<Record<EduAgendaUrlKey, string>> = {},
): string {
  return `/instituto/agenda?${eduAgendaParams(query, next).toString()}`;
}

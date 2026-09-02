/**
 * DaleControl INSTITUCIONAL — LA CLÍNICA EN VIVO, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa). Aquí vive la única cosa de esta ola
 * que, escrita dos veces, terminaría discrepando: **cuándo un sillón está
 * ocupado**.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 1 · EL ESTADO SE DERIVA DE LA CITA, NO DE LA PRESENCIA
 *
 * El producto no registra quién tiene la sesión abierta y no va a empezar
 * ahora — es la decisión que ya tomó la Ola 7 y que está escrita en el
 * panel de Dirección. Un sillón está ocupado porque su cita de HOY está en
 * IN_CHAIR o IN_PROGRESS, no porque alguien tenga la pantalla abierta.
 *
 * La diferencia importa el día que un alumno cierra el navegador con el
 * paciente todavía en el sillón: con presencia, la unidad se pintaría libre
 * y la escuela sentaría a otro encima. Con la cita, sigue ocupada hasta que
 * alguien la cierre — que es el dato que la escuela ya mantiene.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 2 · EL MOTOR SE IMPORTA, NO SE COPIA
 *
 * `src/lib/floor-plan/live-mode.ts` (el modo En Vivo del DENTAL) ya sabe
 * decidir libre / próxima / ocupada, sacar la cita activa, la siguiente, el
 * progreso y enmascarar al paciente. Son funciones puras y se IMPORTAN tal
 * cual: `getChairStatus`, `getChairAppointment`, `getNextChairAppointment`,
 * `appointmentProgress` y `maskPatient`.
 *
 * ⛔ No se editan. La guardia institucional (scripts/edu-guard.cjs) falla si
 * esta ola toca un archivo del dental, y con razón: ese motor está vivo en
 * producción en /live/[slug]. Lo que no encaja se adapta DE ESTE LADO, y
 * eso es exactamente lo que hacen las tres piezas de abajo.
 *
 * ── PIEZA 1 · LA TRADUCCIÓN DE ESTADOS ──────────────────────────────────
 * Los dos productos NO tienen el mismo vocabulario:
 *
 *   dental      PENDING · SCHEDULED · CONFIRMED · CHECKED_IN · IN_PROGRESS
 *   instituto   SCHEDULED · CHECKED_IN · **IN_CHAIR** · IN_PROGRESS
 *
 * `getChairStatus` pinta OCUPADO cuando ve `IN_PROGRESS` y nada más. El
 * vertical tiene DOS estados que ocupan el sillón —IN_CHAIR ("ya está
 * sentado") e IN_PROGRESS ("se le está trabajando")— y el primero no existe
 * en el dental. Sin la traducción, un paciente sentado esperando a que
 * llegue su docente pintaría el sillón de LIBRE y la escuela sentaría a
 * otro encima. Por eso IN_CHAIR viaja como IN_PROGRESS: ver EDU_VIVA_STATUS
 * y su prueba.
 *
 * ── PIEZA 2 · LO MUERTO NO VIAJA ────────────────────────────────────────
 * COMPLETED, CANCELLED y NO_SHOW se descartan ANTES de entrar al motor
 * (mapean a `null`). No es cosmética: `getNextChairAppointment` devuelve la
 * próxima cita SIN mirar su estado, así que una cancelada de las 16:00
 * saldría como "próxima cita a las 16:00" en un sillón que va a estar
 * libre. Y una terminada haría lo mismo por el otro lado.
 *
 * ── PIEZA 3 · LA CITA SE PIDE DESPUÉS DEL ESTADO, NUNCA ANTES ───────────
 * 🔴 Ésta es la trampa fina del motor importado y la razón de que
 * `eduVivaCard` exista. `getChairStatus` en vivo solo dice OCUPADO por
 * `IN_PROGRESS`; `getChairAppointment`, si no encuentra ninguna, se cae a
 * "la cita cuyo rango contiene ahora". Las dos NO contestan lo mismo: una
 * cita SCHEDULED de 9:00 a 10:00 a las 9:30 —el paciente que no llegó y que
 * nadie marcó— deja el sillón LIBRE para la primera y devuelve esa cita
 * para la segunda. Preguntar las dos por separado y pintarlas juntas daría
 * una tarjeta "Libre" con un paciente dentro.
 *
 * Se cierra decidiendo SIEMPRE por el estado y pidiendo la cita después:
 *   · ocupado → getChairAppointment (que ahí sí acierta por IN_PROGRESS)
 *   · próximo → getNextChairAppointment
 *   · libre   → getNextChairAppointment, y solo como pista de "siguiente"
 *
 * ⚠️ Y por lo mismo, `now` tiene que ser el INSTANTE REAL. El motor del
 * dental cambia de criterio cuando `viewTime` se aleja más de 90 s del
 * reloj (ahí sirve a un timeline que "viaja en el tiempo", que esta
 * pantalla no tiene) y pasa a decidir por rango — justo lo que el párrafo
 * de arriba evita. Las pruebas de esta ola construyen sus horas como
 * `Date.now() + offset` por esta razón, no por comodidad.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  appointmentProgress,
  getChairAppointment,
  getChairStatus,
  getNextChairAppointment,
  maskPatient,
} from "@/lib/floor-plan/live-mode";
import type {
  ChairStatus,
  LiveAppointment,
  LiveApptStatus,
} from "@/lib/floor-plan/element-types";
import type { EduAppointmentStatus } from "@/lib/edu/types";
import { eduFormatTime, eduTodayISO, eduUtcToZoned } from "@/lib/edu/agenda-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · CONSTANTES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cada cuánto se vuelve a pedir el tablero.
 *
 * 20 s y no 2: lo que cambia en el piso clínico son MINUTOS (un paciente se
 * sienta, un alumno cierra la sesión), y esta pantalla está pensada para
 * quedarse abierta todo el día en un monitor de pared. Un intervalo de dos
 * segundos serían 1 800 consultas por hora y por pantalla contra las mismas
 * tablas que usa la agenda, para enseñar lo mismo.
 *
 * Es un pelo más rápido que el bloque en vivo del panel de dirección
 * (25 s, EDU_DIR_REFRESCO_MS) a propósito: allá el tablero vivo es una
 * franja dentro de una pantalla de números; aquí ES la pantalla.
 *
 * 🔴 Con la pestaña oculta NO se consulta. Ver la nota del componente.
 */
export const EDU_VIVA_REFRESCO_MS = 20_000;

/**
 * Cada cuánto se recalcula "cuánto lleva" SIN pedir nada al servidor.
 *
 * El minutero de una cita en curso avanza solo: no hace falta una consulta
 * para saber que un paciente que entró a las 10:00 lleva un minuto más que
 * hace un minuto. Este tic es puro reloj de navegador, y por eso puede ser
 * mucho más frecuente que el refresco de datos sin costar nada.
 */
export const EDU_VIVA_TIC_MS = 30_000;

/**
 * La ventana de "próxima", en minutos.
 *
 * 🔴 NO es un parámetro: es el valor que el motor del dental lleva dentro
 * (`PROXIMO_WINDOW_MIN`, privado en live-mode.ts). Se escribe aquí para
 * poder DECIRLO en pantalla ("empieza en menos de 30 min") y hay una prueba
 * que lo comprueba contra el motor de verdad — si el dental lo cambia a 45,
 * la prueba se pone roja en vez de dejar esta pantalla mintiendo.
 */
export const EDU_VIVA_PROXIMA_MIN = 30;

/**
 * Cuántas citas se traen como mucho. El techo de sillones es 200
 * (EDU_MAX_CHAIRS), y a cada uno le pueden colgar varias citas vivas dentro
 * de la ventana: con 8 por sillón sobra para un día de clínica escuela.
 */
export const EDU_VIVA_MAX_CITAS = 1_600;

/**
 * Cuántas horas hacia atrás y hacia adelante se miran las citas.
 *
 * 🔴 El límite HACIA ATRÁS no es una optimización, es una decisión de
 * producto: una cita que alguien dejó en IN_PROGRESS y nunca cerró tiene
 * que dejar de pintar el sillón de rojo en algún momento. Sin suelo, una
 * sesión olvidada del martes deja la unidad "ocupada" hasta que alguien
 * abra la base de datos. Doce horas cubren la jornada más larga de una
 * clínica escuela y se olvidan de la de ayer.
 *
 * Hacia ADELANTE cubre el resto del día en cualquiera de los husos de las
 * sedes; lo que se pinta como "siguiente" se recorta además al día de
 * calendario de SU sede (ver `eduVivaCard`).
 */
export const EDU_VIVA_VENTANA_HORAS = 12;

/** El estado de un sillón, con el vocabulario del motor del dental. */
export type EduVivaState = ChairStatus;

/** Cómo se lee cada estado. La UI JAMÁS pinta el valor crudo. */
export const EDU_VIVA_STATE_LABELS: Record<EduVivaState, string> = {
  libre: "Libre",
  proximo: "Próxima",
  ocupado: "Ocupada",
};

/**
 * Qué significa cada estado, con todas sus letras. Va en la leyenda de la
 * pantalla porque "próxima" no quiere decir lo mismo para todo el mundo.
 */
export const EDU_VIVA_STATE_DETAILS: Record<EduVivaState, string> = {
  libre: "Nadie sentado y nada que empiece en la próxima media hora.",
  proximo: `Hay una cita que empieza en menos de ${EDU_VIVA_PROXIMA_MIN} minutos.`,
  ocupado: "Hay un paciente en el sillón (sentado o en tratamiento).",
};

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA TRADUCCIÓN DE ESTADOS  (pieza 1 y 2 de la nota de arriba)
// ═══════════════════════════════════════════════════════════════════════

/**
 * EduAppointmentStatus → el vocabulario del motor del dental.
 * `null` = esta cita NO entra al tablero.
 *
 * 🔴 IN_CHAIR → IN_PROGRESS es LA línea de esta ola. El dental no tiene
 * "sentado pero todavía sin empezar" y su motor solo pinta rojo con
 * IN_PROGRESS; sin esta traducción, el paciente que espera a su docente
 * dejaría el sillón pintado de verde.
 *
 * ⚠️ Se escribe como Record COMPLETO y no con un `switch` con `default`: si
 * mañana el enum del vertical gana un estado, TypeScript se pone rojo aquí
 * y obliga a decidir si ocupa el sillón o no. Un `default` habría contestado
 * por su cuenta, y la respuesta silenciosa —sea la que sea— es la que deja
 * un sillón mal pintado sin que nadie lo note.
 */
export const EDU_VIVA_STATUS: Record<EduAppointmentStatus, LiveApptStatus | null> = {
  SCHEDULED: "SCHEDULED",
  CHECKED_IN: "CHECKED_IN",
  // 🔴 Ya está sentado: el sillón está OCUPADO aunque nadie haya empezado.
  IN_CHAIR: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  // Lo muerto no viaja: ver la PIEZA 2 de la nota de cabecera.
  COMPLETED: null,
  CANCELLED: null,
  NO_SHOW: null,
};

/** ¿Este estado del vertical ocupa el sillón? */
export function eduVivaOcupa(status: EduAppointmentStatus): boolean {
  return EDU_VIVA_STATUS[status] === "IN_PROGRESS";
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LO QUE ENTRA Y LO QUE SALE
// ═══════════════════════════════════════════════════════════════════════

/** Un sillón ACTIVO del piso, ya recortado por sede. */
export interface EduVivaChairInput {
  id: string;
  name: string;
  number: number;
  campusId: string;
  campusName: string;
  /**
   * La zona horaria de SU sede. Cada tarjeta pinta su hora en la hora de
   * PARED de su edificio: las 9:00 del campus de Tijuana y las 9:00 del de
   * Mérida no son el mismo instante, y una rejilla que las pusiera en la
   * misma columna estaría mintiendo. Aquí no hace falta elegir un huso
   * único —como sí tiene que hacer la agenda— porque cada tarjeta es UN
   * sitio.
   */
  campusTimezone: string;
}

/** Una cita viva, ya resuelta contra la base. */
export interface EduVivaApptInput {
  id: string;
  chairId: string;
  startsAt: Date;
  endsAt: Date;
  status: EduAppointmentStatus;
  patientName: string;
  patientFolio: string;
  studentName: string;
  studentMatricula: string;
  /** La especialidad del CASO (o la del estudiante si la cita no trae caso). */
  specialty: string | null;
  /**
   * ¿El DETALLE de esta cita le toca a quien está mirando?
   *
   * 🔴 Lo decide `src/lib/edu/visibility.ts` y NADIE más — este módulo
   * recibe el booleano ya resuelto. Es el punto único de la visibilidad del
   * vertical y esta ola no abre un segundo.
   */
  detail: boolean;
}

/** Una tarjeta del tablero: un sillón y lo que le pasa ahora mismo. */
export interface EduVivaCard {
  chairId: string;
  chairName: string;
  number: number;
  campusId: string;
  campusName: string;
  state: EduVivaState;
  /**
   * true = el sillón tiene a alguien, pero el detalle no le toca a quien
   * mira. La tarjeta sigue diciendo OCUPADA —el estado del piso no es
   * secreto— y calla el nombre.
   */
  masked: boolean;
  /** Nombre del paciente, o sus iniciales cuando `masked`. */
  patient: string | null;
  patientFolio: string | null;
  student: string | null;
  studentMatricula: string | null;
  specialty: string | null;
  /** Instante de inicio (ISO). El navegador calcula el minutero con él. */
  startISO: string | null;
  /** "09:30", en la hora de pared de SU sede. */
  startLabel: string | null;
  endLabel: string | null;
  /** Minutos que lleva la cita en curso (solo cuando `state === "ocupado"`). */
  elapsedMin: number | null;
  /** Minutos que faltan para la próxima (solo cuando `state === "proximo"`). */
  startsInMin: number | null;
  /** 0..1 de la cita en curso, para la barra. */
  progress: number | null;
  /** "Siguiente 14:30" en un sillón libre. null si no hay más hoy. */
  nextLabel: string | null;
}

export interface EduVivaCounts {
  libre: number;
  proximo: number;
  ocupado: number;
  total: number;
}

export interface EduVivaBoard {
  /** Cuándo se armó (ISO). La pantalla lo pinta: un tablero pegado miente. */
  generatedAt: string;
  cards: EduVivaCard[];
  counts: EduVivaCounts;
  /** Los mismos conteos, por sede. Se pintan en la vista consolidada. */
  byCampus: { campusId: string; campusName: string; counts: EduVivaCounts }[];
  /** true = hubo más citas de las que caben (EDU_VIVA_MAX_CITAS). */
  truncated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL MOTOR, ADAPTADO
// ═══════════════════════════════════════════════════════════════════════

/**
 * EduAppointment → LiveAppointment. Devuelve `null` para lo que no entra.
 *
 * El `resourceId` es el id del SILLÓN: es lo que `getChairStatus` compara,
 * y es lo que en el dental sería el Resource(kind=CHAIR).
 *
 * ⚠️ `patient` y `doctor` viajan en claro; el enmascarado se aplica DESPUÉS
 * (en `eduVivaCard`), sobre lo que sale a pantalla. Meterlo aquí obligaría a
 * pasar el alcance a una función de traducción, que es donde se pierde.
 */
export function eduVivaLiveAppt(a: EduVivaApptInput): LiveAppointment | null {
  const status = EDU_VIVA_STATUS[a.status];
  if (!status) return null;
  return {
    id: a.id,
    resourceId: a.chairId,
    patient: a.patientName,
    treatment: a.specialty ?? "",
    doctor: a.studentName,
    start: a.startsAt,
    end: a.endsAt,
    status,
  };
}

/** Minutos enteros entre dos instantes (nunca negativo). */
function minutosDesde(desde: Date, hasta: Date): number {
  return Math.max(0, Math.floor((hasta.getTime() - desde.getTime()) / 60_000));
}

/** Minutos enteros que FALTAN (redondeados hacia arriba: "en 1 min", no "en 0"). */
function minutosHasta(cuando: Date, ahora: Date): number {
  return Math.max(0, Math.ceil((cuando.getTime() - ahora.getTime()) / 60_000));
}

/**
 * La tarjeta de UN sillón.
 *
 * 🔴 El orden importa y es la PIEZA 3 de la nota de cabecera: primero el
 * ESTADO, y solo después se pide la cita que corresponde a ese estado. Al
 * revés, una cita SCHEDULED cuyo rango contiene "ahora" pintaría una
 * tarjeta "Libre" con un paciente dentro.
 */
export function eduVivaCard(
  chair: EduVivaChairInput,
  appts: EduVivaApptInput[],
  now: Date,
): EduVivaCard {
  const vivas: LiveAppointment[] = [];
  const porId = new Map<string, EduVivaApptInput>();
  for (const a of appts) {
    if (a.chairId !== chair.id) continue;
    const live = eduVivaLiveAppt(a);
    if (!live) continue;
    vivas.push(live);
    porId.set(a.id, a);
  }

  const state = getChairStatus(chair.id, now, vivas);

  const base: EduVivaCard = {
    chairId: chair.id,
    chairName: chair.name,
    number: chair.number,
    campusId: chair.campusId,
    campusName: chair.campusName,
    state,
    masked: false,
    patient: null,
    patientFolio: null,
    student: null,
    studentMatricula: null,
    specialty: null,
    startISO: null,
    startLabel: null,
    endLabel: null,
    elapsedMin: null,
    startsInMin: null,
    progress: null,
    nextLabel: null,
  };

  if (state === "ocupado") {
    const live = getChairAppointment(chair.id, now, vivas);
    const cita = live ? porId.get(live.id) : null;
    // Sin cita no debería pasar (el estado salió de ella), pero un tablero
    // que revienta en un caso raro es peor que uno que dice "ocupada" y ya.
    if (!live || !cita) return base;
    return {
      ...base,
      ...eduVivaDetalle(cita),
      startISO: cita.startsAt.toISOString(),
      startLabel: eduFormatTime(cita.startsAt, chair.campusTimezone),
      endLabel: eduFormatTime(cita.endsAt, chair.campusTimezone),
      elapsedMin: minutosDesde(cita.startsAt, now),
      progress: appointmentProgress(live, now),
    };
  }

  const siguiente = getNextChairAppointment(chair.id, now, vivas);
  const cita = siguiente ? porId.get(siguiente.id) : null;
  if (!siguiente || !cita) return base;

  if (state === "proximo") {
    return {
      ...base,
      ...eduVivaDetalle(cita),
      startISO: cita.startsAt.toISOString(),
      startLabel: eduFormatTime(cita.startsAt, chair.campusTimezone),
      endLabel: eduFormatTime(cita.endsAt, chair.campusTimezone),
      startsInMin: minutosHasta(cita.startsAt, now),
    };
  }

  // LIBRE con algo más tarde: se pinta la hora como PISTA y nada más — ni
  // paciente ni estudiante. Un sillón libre no tiene por qué enseñar el
  // nombre de quien va a llegar en cuatro horas, y la pantalla se lee de
  // lejos: lo útil es "libre hasta las 14:30".
  //
  // 🔴 Solo si es HOY en la hora de SU sede. La ventana de la consulta son
  // 12 horas en instantes, y sin este recorte un sillón libre a las 21:00
  // anunciaría la primera cita de mañana como si fuera de esta tarde.
  const dia = eduUtcToZoned(cita.startsAt, chair.campusTimezone).dayISO;
  if (dia !== eduTodayISO(chair.campusTimezone, now)) return base;
  return { ...base, nextLabel: eduFormatTime(cita.startsAt, chair.campusTimezone) };
}

/**
 * El detalle identificable de una cita — o su versión callada.
 *
 * 🔴 EL ESTADO DEL PISO NO ES SECRETO; EL PACIENTE SÍ. Un sillón fuera del
 * alcance de quien mira sigue diciendo OCUPADA (si no, el tablero mentiría
 * sobre cuántas unidades quedan libres, que es la mitad de para qué existe)
 * y calla el nombre del paciente, el del estudiante y la especialidad.
 *
 * Del paciente quedan las INICIALES, con el `maskPatient` del motor del
 * dental —que es exactamente para lo que existe— para poder distinguir dos
 * sillones sin identificar a nadie.
 */
function eduVivaDetalle(
  cita: EduVivaApptInput,
): Pick<
  EduVivaCard,
  "masked" | "patient" | "patientFolio" | "student" | "studentMatricula" | "specialty"
> {
  if (!cita.detail) {
    return {
      masked: true,
      patient: maskPatient(cita.patientName, false),
      patientFolio: null,
      student: null,
      studentMatricula: null,
      specialty: null,
    };
  }
  return {
    masked: false,
    patient: cita.patientName,
    patientFolio: cita.patientFolio,
    student: cita.studentName,
    studentMatricula: cita.studentMatricula,
    specialty: cita.specialty,
  };
}

function contar(cards: EduVivaCard[]): EduVivaCounts {
  const counts: EduVivaCounts = { libre: 0, proximo: 0, ocupado: 0, total: cards.length };
  for (const c of cards) counts[c.state] += 1;
  return counts;
}

/**
 * El tablero completo.
 *
 * Los sillones llegan YA filtrados: activos, de las sedes que le tocan a
 * quien mira y —si eligió una— de esa sede. Este módulo no vuelve a
 * decidirlo: un segundo filtro es un segundo sitio donde discrepar.
 *
 * ⚠️ Una cita de un sillón que no está en la lista NO se cuela: cada
 * tarjeta solo mira las citas de SU `chairId`. Es lo que impide que el
 * "Sillón 1" del campus norte muestre al paciente del "Sillón 1" del sur —
 * los ids son distintos aunque el número sea el mismo, porque el número es
 * único dentro de la SEDE y no del instituto.
 */
export function buildEduVivaBoard(input: {
  chairs: EduVivaChairInput[];
  appointments: EduVivaApptInput[];
  now: Date;
  truncated?: boolean;
}): EduVivaBoard {
  const cards = input.chairs.map((c) => eduVivaCard(c, input.appointments, input.now));

  const porSede = new Map<string, EduVivaCard[]>();
  for (const c of cards) {
    const lista = porSede.get(c.campusId) ?? [];
    lista.push(c);
    porSede.set(c.campusId, lista);
  }

  return {
    generatedAt: input.now.toISOString(),
    cards,
    counts: contar(cards),
    byCampus: Array.from(porSede.entries()).map(([campusId, lista]) => ({
      campusId,
      campusName: lista[0]?.campusName ?? "",
      counts: contar(lista),
    })),
    truncated: input.truncated === true,
  };
}

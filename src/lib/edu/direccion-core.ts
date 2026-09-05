/**
 * DaleControl INSTITUCIONAL — EL PANEL DE DIRECCIÓN, la parte que se puede
 * comprobar SIN base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa). Aquí viven las CUENTAS —la ventana
 * del periodo, la variación, la ocupación del sillón, el semáforo y el
 * CSV— y en direccion.ts vive lo que las alimenta.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA REGLA DE ESTA PANTALLA: NINGÚN NÚMERO INVENTADO.
 *
 * Un panel de dirección se proyecta en una junta y se lee en voz alta. Un
 * número aproximado ahí no es "una aproximación": es una decisión tomada
 * sobre un dato falso. Así que todo lo que se pinta o sale de una fila de
 * la base, o no se pinta.
 *
 * De ahí salen tres decisiones que conviene leer antes de tocar nada:
 *
 * 1. NO HAY "ALUMNOS CONECTADOS" NI "DOCENTES EN PISO". El producto no
 *    registra presencia: nadie ficha al entrar a la clínica. Se podría
 *    haber puesto un latido (una columna que la sesión del panel toca cada
 *    pocos minutos), y se decidió NO hacerlo — un latido cuenta PESTAÑAS
 *    ABIERTAS, no gente. El alumno que está tratando a un paciente con el
 *    teléfono en el bolsillo cuenta cero, y el director con tres pestañas
 *    cuenta uno. Proyectado en una pared, "23 conectados" se lee como "23
 *    alumnos en la clínica" y sería falso justo cuando importa.
 *    En su lugar se pintan dos cifras que SÍ son exactas:
 *      · PACIENTES EN LA CLÍNICA  → citas de hoy en CHECKED_IN / IN_CHAIR /
 *        IN_PROGRESS: gente que llegó y no se ha ido.
 *      · DOCENTES RESPONSABLES    → los docentes distintos que responden
 *        AHORA por lo que hay en los sillones (el supervisor de la cita, y
 *        si la cita no lo trae, el titular VIGENTE del alumno).
 *
 * 2. EL AVANCE ACADÉMICO NO SE RECALCULA AQUÍ. Sale de la Ola 6
 *    (`listEduEvaluacion` → `eduAtrasoVerdict`), tal cual, con su motivo.
 *    Una segunda cuenta del mismo número es cómo se llega a que la
 *    pantalla de Evaluación diga 5 y la de Dirección diga 6.
 *
 * 3. LO QUE NO SE PUEDE ATRIBUIR SE DICE, NO SE REPARTE. Un cobro solo
 *    tiene especialidad si trae caso, y caja cobra sin abrir expediente:
 *    la tabla por especialidad enseña una fila "Sin caso" con lo que
 *    quedó fuera en vez de repartirlo a ojo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  eduDayRange,
  eduFormatDayShort,
  eduFormatDayLong,
  EDU_WEEKDAY_SHORT,
  eduSafeTimeZone,
  eduShiftDayISO,
  eduTodayISO,
  eduUtcToZoned,
  eduWeekdayOf,
  parseEduDayISO,
  type EduScheduleSlot,
} from "@/lib/edu/agenda-core";
import { eduMoney } from "@/lib/edu/dinero-core";
import {
  eduCsvFile,
  eduCsvRow,
  eduHoursLabel,
  EDU_ATRASO_LABELS,
  EDU_ATRASO_UMBRAL_VIGILAR,
  type EduAtrasoEstado,
} from "@/lib/edu/evaluacion-core";
import type { EduPersonaKind } from "@/lib/edu/persona-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · TOPES Y UMBRALES
//
// Todos con nombre y aquí arriba: son números que la escuela va a discutir,
// y cuando lo haga tienen que cambiarse en UN sitio. Que sean arbitrarios
// no los hace opcionales.
// ═══════════════════════════════════════════════════════════════════════

/** El rango personalizado más largo que se pinta. Más allá, el CSV. */
export const EDU_DIR_MAX_DIAS = 366;

/**
 * Cuántas citas del periodo se traen para las cuentas. Es un tope de
 * MEMORIA, no de producto: por encima de esto la pantalla lo DICE en vez de
 * enseñar un total que se quedó corto sin avisar.
 */
export const EDU_DIR_MAX_CITAS = 20000;

/** Lo mismo para casos y cobros del periodo. */
export const EDU_DIR_MAX_FILAS = 10000;

/** Cuántas filas devuelve como mucho la lista que hay detrás de una cifra. */
export const EDU_DIR_MAX_DETALLE = 200;

/**
 * Cuántas autorizaciones PENDIENTES se traen para pintar la rejilla en
 * vivo.
 *
 * Se traen TODAS las del instituto y no las de unos `caseId` concretos, y
 * eso tiene una razón: la agenda casi nunca engancha la cita a su caso, así
 * que filtrar por los casos de las citas que hay en los sillones dejaría
 * fuera casi todas las esperas — y "esperando docente" es la mitad de para
 * qué existe esa rejilla. Las pendientes de un instituto son pocas (es la
 * bandeja del docente, no un histórico), pero el tope está por si una
 * escuela deja de firmar durante un mes.
 */
export const EDU_DIR_MAX_PENDIENTES_VIVAS = 500;

/**
 * A partir de cuántos minutos esperando una firma el sillón se pinta ROJO.
 * Antes de eso es ámbar: alguien espera, pero todavía no es un problema.
 *
 * 🔴 Es arbitrario y por eso está aquí con nombre. Sin umbral, un sillón
 * se pondría rojo el segundo en que el alumno manda la autorización y la
 * dirección dejaría de mirar el tablero en una semana.
 */
export const EDU_DIR_ESPERA_ROJA_MIN = 15;

/** Una firma pendiente más vieja que esto es ROJA en Pendientes. */
export const EDU_DIR_FIRMA_VIEJA_MIN = 60;

/** Por debajo de esta ocupación, un sillón está desaprovechado. */
export const EDU_DIR_SILLON_BAJO = 0.3;

/** Cuántos alumnos se listan en "los de más actividad" y en "atrasados". */
export const EDU_DIR_TOP_ALUMNOS = 8;

/**
 * Cada cuánto se vuelve a pedir el bloque EN VIVO.
 *
 * 25 s y no 5: lo que cambia en el piso clínico son minutos (un paciente se
 * sienta, un docente firma), y una consulta cada cinco segundos por cada
 * director con el tablero abierto es carga constante sobre las mismas
 * tablas que usa la agenda. El cliente además NO consulta con la pestaña
 * oculta.
 */
export const EDU_DIR_REFRESCO_MS = 25_000;

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL PERIODO
//
// 🔴 VENTANAS QUE RUEDAN, NO MESES DE CALENDARIO. "Semana" son los últimos
// 7 días terminando hoy y "Mes" los últimos 30, y se compara contra los 7
// (o 30) inmediatamente anteriores. Con el mes de calendario, el día 3 se
// compararía un mes de tres días contra uno de treinta y la variación
// diría −90 % todos los meses.
// ═══════════════════════════════════════════════════════════════════════

export type EduDirPeriodo = "hoy" | "semana" | "mes" | "rango";

export const EDU_DIR_PERIODOS: EduDirPeriodo[] = ["hoy", "semana", "mes", "rango"];

export const EDU_DIR_PERIODO_LABELS: Record<EduDirPeriodo, string> = {
  hoy: "Hoy",
  semana: "Semana",
  mes: "Mes",
  rango: "Personalizado",
};

/** Cuántos días cubre cada periodo fijo. */
const DIAS_POR_PERIODO: Record<Exclude<EduDirPeriodo, "rango">, number> = {
  hoy: 1,
  semana: 7,
  mes: 30,
};

export function parseEduDirPeriodo(raw: unknown): EduDirPeriodo | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (EDU_DIR_PERIODOS as string[]).includes(v) ? (v as EduDirPeriodo) : null;
}

export interface EduDirFiltrosCrudos {
  periodo?: unknown;
  desde?: unknown;
  hasta?: unknown;
  especialidad?: unknown;
}

/**
 * Los cuatro parámetros de la URL, leídos SIEMPRE con los mismos nombres.
 *
 * Existe para que la pantalla, los tres endpoints y la exportación no
 * puedan discrepar: si el CSV leyera `p` y la pantalla `periodo`, el
 * archivo que la dirección se lleva a la acreditación sería de otro
 * periodo que el que estaba mirando — y se vería exactamente igual que
 * "funciona".
 */
export function eduDirFiltrosDeQuery(params: URLSearchParams): EduDirFiltrosCrudos {
  return {
    periodo: params.get("periodo"),
    desde: params.get("desde"),
    hasta: params.get("hasta"),
    especialidad: params.get("especialidad"),
  };
}

/** Lo mismo desde los `searchParams` de una página de Next. */
export function eduDirFiltrosDeSearchParams(
  sp: { [key: string]: string | string[] | undefined } | undefined,
): EduDirFiltrosCrudos {
  const uno = (v: string | string[] | undefined): string | null =>
    (Array.isArray(v) ? v[0] : v) ?? null;
  const s = sp ?? {};
  return {
    periodo: uno(s.periodo),
    desde: uno(s.desde),
    hasta: uno(s.hasta),
    especialidad: uno(s.especialidad),
  };
}

/** La misma URL, armada al revés: de los filtros a la query. */
export function eduDirQueryDeFiltros(f: {
  periodo?: string | null;
  desde?: string | null;
  hasta?: string | null;
  especialidad?: string | null;
}): string {
  const params = new URLSearchParams();
  if (f.periodo) params.set("periodo", f.periodo);
  if (f.periodo === "rango" && f.desde) params.set("desde", f.desde);
  if (f.periodo === "rango" && f.hasta) params.set("hasta", f.hasta);
  if (f.especialidad) params.set("especialidad", f.especialidad);
  return params.toString();
}

export interface EduDirVentana {
  periodo: EduDirPeriodo;
  /** Primer día del periodo, en el calendario del INSTITUTO. */
  desdeISO: string;
  /** Último día INCLUIDO. */
  hastaISO: string;
  dias: number;
  /** Instantes: [from, to) — el extremo derecho es EXCLUSIVO. */
  from: Date;
  to: Date;
  /** El periodo anterior, del MISMO largo, pegado por la izquierda. */
  prevDesdeISO: string;
  prevFrom: Date;
  prevTo: Date;
  /** Lo que se lee arriba de todo: "Últimos 7 días · 24 ago – 30 ago". */
  label: string;
  /** Contra qué se compara, en una frase. */
  compara: string;
  /**
   * Un aviso cuando la comparación no es limpia (hoy va a medias) o cuando
   * el rango se recortó. null = no hay nada que advertir.
   */
  aviso: string | null;
}

/**
 * La ventana del periodo, en la zona horaria del INSTITUTO.
 *
 * 🔴 La zona sale de `EduInstitution.timezone`, no del navegador. Si el
 * corte del día se hiciera en UTC, en México "hoy" empezaría a las 18:00
 * del día anterior y el tablero de la mañana enseñaría las citas de ayer.
 */
export function eduDirVentana(
  filtros: EduDirFiltrosCrudos,
  timeZoneCrudo: string,
  now: Date = new Date(),
): EduDirVentana {
  const tz = eduSafeTimeZone(timeZoneCrudo);
  const hoyISO = eduTodayISO(tz, now);

  const pedido = parseEduDirPeriodo(filtros?.periodo) ?? "hoy";
  const desdeCrudo = parseEduDayISO(filtros?.desde);
  const hastaCrudo = parseEduDayISO(filtros?.hasta);

  let periodo: EduDirPeriodo = pedido;
  let desdeISO: string;
  let hastaISO: string;
  let aviso: string | null = null;

  if (pedido === "rango" && desdeCrudo && hastaCrudo) {
    // Al revés se endereza en vez de rebotar: teclear las dos fechas en el
    // orden equivocado es lo más fácil del mundo y no es un error del que
    // haya nada que aprender.
    const a = desdeCrudo <= hastaCrudo ? desdeCrudo : hastaCrudo;
    const b = desdeCrudo <= hastaCrudo ? hastaCrudo : desdeCrudo;
    desdeISO = a;
    hastaISO = b;
    const largo = diasEntre(a, b);
    if (largo > EDU_DIR_MAX_DIAS) {
      hastaISO = eduShiftDayISO(a, EDU_DIR_MAX_DIAS - 1);
      aviso = `El rango pedido pasaba de ${EDU_DIR_MAX_DIAS} días y se recortó a los primeros ${EDU_DIR_MAX_DIAS}. Para un periodo más largo, exporta el CSV.`;
    }
  } else {
    // "rango" sin fechas cae a "hoy": un periodo vacío no se pinta en
    // blanco, se resuelve al que siempre tiene sentido.
    if (pedido === "rango") periodo = "hoy";
    const dias = DIAS_POR_PERIODO[periodo as Exclude<EduDirPeriodo, "rango">];
    hastaISO = hoyISO;
    desdeISO = eduShiftDayISO(hoyISO, -(dias - 1));
  }

  const dias = diasEntre(desdeISO, hastaISO);
  const actual = eduDayRange(desdeISO, tz, dias);
  const prevDesdeISO = eduShiftDayISO(desdeISO, -dias);
  const previo = eduDayRange(prevDesdeISO, tz, dias);

  // eduDayRange solo devuelve null con un día ilegible, y los dos ya
  // pasaron por parseEduDayISO. El fallback existe para no propagar un
  // `null` a un `where` de Prisma, que borraría el filtro de fechas.
  const from = actual?.from ?? new Date(now.getTime());
  const to = actual?.to ?? new Date(now.getTime());
  const prevFrom = previo?.from ?? from;
  const prevTo = previo?.to ?? from;

  if (!aviso && periodo === "hoy") {
    aviso =
      "Hoy va a medias y ayer está completo: la variación de esta franja se lee con eso en mente.";
  }

  return {
    periodo,
    desdeISO,
    hastaISO,
    dias,
    from,
    to,
    prevDesdeISO,
    prevFrom,
    prevTo,
    label: etiquetaVentana(periodo, desdeISO, hastaISO, dias),
    compara:
      dias === 1
        ? "contra el día anterior"
        : `contra los ${dias} días anteriores (${eduFormatDayShort(prevDesdeISO)} – ${eduFormatDayShort(eduShiftDayISO(desdeISO, -1))})`,
    aviso,
  };
}

function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = parseEduDayISO(desdeISO);
  const b = parseEduDayISO(hastaISO);
  if (!a || !b) return 1;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function etiquetaVentana(
  periodo: EduDirPeriodo,
  desdeISO: string,
  hastaISO: string,
  dias: number,
): string {
  if (periodo === "hoy") return `Hoy · ${eduFormatDayLong(hastaISO)}`;
  const tramo = `${eduFormatDayShort(desdeISO)} – ${eduFormatDayShort(hastaISO)}`;
  if (periodo === "semana") return `Últimos 7 días · ${tramo}`;
  if (periodo === "mes") return `Últimos 30 días · ${tramo}`;
  return `${tramo} · ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** Cuántas veces cae cada día de la semana (0=domingo) dentro del periodo. */
export function eduDirWeekdayCounts(desdeISO: string, dias: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const n = Math.max(0, Math.min(Math.trunc(dias), EDU_DIR_MAX_DIAS));
  for (let i = 0; i < n; i += 1) {
    out[eduWeekdayOf(eduShiftDayISO(desdeISO, i))] += 1;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA VARIACIÓN CONTRA EL PERIODO ANTERIOR
// ═══════════════════════════════════════════════════════════════════════

export interface EduDirVariacion {
  /** actual − anterior. */
  delta: number;
  /**
   * El porcentaje, ENTERO. `null` cuando NO SE PUEDE calcular: el periodo
   * anterior fue cero. Dividir entre cero y enseñar "+∞ %" o "+100 %" es
   * exactamente el número inventado que esta pantalla no admite.
   */
  pct: number | null;
  /** Lo que se lee: "+12 % (18 → 20)" o "sin comparación: antes fue 0". */
  texto: string;
  /** 1 sube, −1 baja, 0 igual. Para la flecha; el color lo decide quien
   *  llama, porque "más" no siempre es "mejor" (citas perdidas). */
  sentido: 1 | 0 | -1;
}

export function eduDirVariacion(actual: number, anterior: number): EduDirVariacion {
  const a = Number.isFinite(actual) ? actual : 0;
  const b = Number.isFinite(anterior) ? anterior : 0;
  const delta = a - b;
  const sentido: 1 | 0 | -1 = delta > 0 ? 1 : delta < 0 ? -1 : 0;

  if (b === 0) {
    return {
      delta,
      pct: null,
      texto: a === 0 ? "igual que antes: 0 en los dos periodos" : `antes no hubo ninguno (0 → ${a})`,
      sentido,
    };
  }

  const pct = Math.round((delta / Math.abs(b)) * 100);
  const signo = pct > 0 ? "+" : "";
  return { delta, pct, texto: `${signo}${pct} % (${b} → ${a})`, sentido };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL SEMÁFORO
//
// 🔴 SIGNIFICA SIEMPRE LO MISMO, EN TODA LA PANTALLA:
//   · ACTUAR (rojo)  → alguien tiene que hacer algo, hoy.
//   · VIGILAR (ámbar)→ mirar, todavía no urge.
//   · OK (verde)     → va bien.
//   · NEUTRO (gris)  → no hay nada que juzgar (o no se puede saber).
// El color NUNCA adorna: si una cifra no puede ponerse roja por ninguna
// razón, va en NEUTRO.
// ═══════════════════════════════════════════════════════════════════════

export type EduDirSemaforo = "ACTUAR" | "VIGILAR" | "OK" | "NEUTRO";

export const EDU_DIR_SEMAFORO_LABELS: Record<EduDirSemaforo, string> = {
  ACTUAR: "Hay que actuar",
  VIGILAR: "Vigilar",
  OK: "Va bien",
  NEUTRO: "Sin juicio",
};

/** La clase de píldora que le toca a cada color. Un solo mapa: dos serían
 *  dos oportunidades de que el rojo signifique cosas distintas. */
export const EDU_DIR_SEMAFORO_TAG: Record<EduDirSemaforo, string> = {
  ACTUAR: "edu-tag--danger",
  VIGILAR: "edu-tag--warn",
  OK: "edu-tag--ok",
  NEUTRO: "edu-tag--muted",
};

/** El semáforo de la Ola 6 traducido al de esta pantalla, sin reinterpretar
 *  nada: el que va atrasado es el que hay que llamar. */
export function eduDirSemaforoDeAtraso(estado: EduAtrasoEstado | null): EduDirSemaforo {
  if (estado === "ATRASADO") return "ACTUAR";
  if (estado === "VIGILAR") return "VIGILAR";
  if (estado === "AL_DIA") return "OK";
  return "NEUTRO";
}

/** Etiqueta del estado académico, con "sin calcular" para el null. */
export function eduDirAtrasoLabel(estado: EduAtrasoEstado | null): string {
  return estado ? EDU_ATRASO_LABELS[estado] : "Sin calcular";
}

export interface EduDirAgregado {
  estado: EduAtrasoEstado | null;
  /** Σ cumplidos ÷ Σ del plan, 0..1. null = no hay plan capturado. */
  avance: number | null;
  /** Lo que se esperaría a esta altura, 0..1. null = sin fechas. */
  esperado: number | null;
  motivo: string;
}

export interface EduDirAgregadoInput {
  /** De TODOS los alumnos activos: es la BARRA de avance, que no necesita
   *  fechas para tener sentido ("llevan 40 de 120 del plan"). */
  hechos: number;
  totales: number;
  /**
   * Solo de los alumnos MEDIBLES (los de una generación con fecha de
   * inicio y de fin): es el SEMÁFORO.
   *
   * 🔴 Van aparte de los de arriba y ésa es toda la función. Si un alumno
   * cuya generación no tiene fechas sumara a `totales` y no a `esperados`
   * —que es lo que devuelve la Ola 6 para él: esperados 0—, arrastraría a
   * su especialidad entera hacia "ATRASADO" por un dato administrativo que
   * nadie capturó. Y ese rojo se lo enseñaría alguien a un grupo de
   * alumnos.
   */
  hechosMedibles: number;
  esperados: number;
  totalesMedibles: number;
  /** Cuántos alumnos se pudieron medir. */
  medibles: number;
}

/**
 * El semáforo de una ESPECIALIDAD ENTERA: la suma de sus alumnos.
 *
 * 🔴 NO es una segunda regla de atraso. El veredicto por alumno lo sigue
 * calculando la Ola 6 (`eduAtrasoVerdict`), con su tope por requisito y su
 * motivo; lo único nuevo aquí es SUMAR esos veredictos por especialidad, y
 * el umbral que decide el color es EL MISMO —
 * `EDU_ATRASO_UMBRAL_VIGILAR`, importado, no copiado—. Si mañana la
 * escuela lo discute y lo mueve, se mueve para las dos pantallas a la vez.
 *
 * ⚠️ Los alumnos SIN semáforo (su generación no tiene fechas) suman a los
 * totales pero no al esperado, así que la especialidad sale "sin calcular"
 * cuando NINGUNO de sus alumnos se puede medir. Es la misma decisión de la
 * Ola 6: antes que un rojo por un dato que la escuela nunca capturó, se
 * dice que no se puede saber.
 */
export function eduDirEstadoAgregado(input: EduDirAgregadoInput): EduDirAgregado {
  const { hechos, totales, hechosMedibles, esperados, totalesMedibles, medibles } = input;
  const avance = totales > 0 ? Math.min(1, hechos / totales) : null;

  if (totales <= 0) {
    return {
      estado: null,
      avance: null,
      esperado: null,
      motivo:
        "Esta especialidad todavía no tiene requisitos capturados, así que no hay nada contra qué medirla. Captúralos en Requisitos.",
    };
  }
  if (medibles <= 0 || totalesMedibles <= 0) {
    return {
      estado: null,
      avance,
      esperado: null,
      motivo:
        "No se puede calcular: a las generaciones de esta especialidad les falta la fecha de inicio o la de fin. Captúralas en Especialidades y generaciones y el semáforo aparece solo.",
    };
  }
  if (esperados <= 0) {
    return {
      estado: "AL_DIA",
      avance,
      esperado: 0,
      motivo: `El ciclo apenas empieza: todavía no se espera nada. Llevan ${hechos} de ${totales}.`,
    };
  }

  const ratio = hechosMedibles / esperados;
  const estado: EduAtrasoEstado =
    ratio >= 1 ? "AL_DIA" : ratio >= EDU_ATRASO_UMBRAL_VIGILAR ? "VIGILAR" : "ATRASADO";
  return {
    estado,
    avance,
    esperado: Math.min(1, esperados / totalesMedibles),
    motivo: `A esta altura del ciclo se esperan ${Math.round(esperados)} de ${totalesMedibles} y llevan ${hechosMedibles}${
      medibles === 1 ? " (1 estudiante medible)" : ` (${medibles} estudiantes medibles)`
    }.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL SILLÓN, AHORA
// ═══════════════════════════════════════════════════════════════════════

/**
 * En qué está un sillón EN ESTE MOMENTO.
 *
 * ⚠️ CHECKED_IN no ocupa el sillón: el paciente llegó a recepción y todavía
 * no se sentó. Meterlo aquí inflaría "sillones en uso" con gente que está
 * en la sala de espera, y esa cifra es justamente la que decide si caben
 * más pacientes.
 */
export type EduDirSillonEstado = "LIBRE" | "ATENDIENDO" | "ESPERA" | "ESPERA_LARGA";

export const EDU_DIR_SILLON_LABELS: Record<EduDirSillonEstado, string> = {
  LIBRE: "Libre",
  ATENDIENDO: "Atendiendo",
  ESPERA: "Esperando docente",
  ESPERA_LARGA: "Esperando docente",
};

export const EDU_DIR_SILLON_SEMAFORO: Record<EduDirSillonEstado, EduDirSemaforo> = {
  // Un sillón libre no es un problema: a las siete de la tarde están todos.
  LIBRE: "NEUTRO",
  ATENDIENDO: "OK",
  ESPERA: "VIGILAR",
  ESPERA_LARGA: "ACTUAR",
};

/**
 * El estado del sillón a partir de lo que hay dentro.
 *
 * `esperaMinutos` es null cuando no hay ninguna autorización PENDING del
 * caso que está en el sillón; en cuanto la hay, el sillón deja de estar
 * "atendiendo" — porque no se está atendiendo: se está esperando una firma.
 */
export function eduDirSillonEstado(
  ocupado: boolean,
  esperaMinutos: number | null,
): EduDirSillonEstado {
  if (!ocupado) return "LIBRE";
  if (esperaMinutos === null || !Number.isFinite(esperaMinutos)) return "ATENDIENDO";
  return esperaMinutos >= EDU_DIR_ESPERA_ROJA_MIN ? "ESPERA_LARGA" : "ESPERA";
}

/** Minutos enteros entre dos instantes, nunca negativos. */
export function eduDirMinutosDesde(desde: Date | string | null | undefined, now: Date): number | null {
  if (!desde) return null;
  const d = desde instanceof Date ? desde : new Date(desde);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60_000));
}

/** "hace 12 min" / "hace 2 h 05 min". Para una espera, no para una fecha. */
export function eduDirEsperaLabel(minutos: number | null): string {
  if (minutos === null || !Number.isFinite(minutos)) return "—";
  if (minutos < 1) return "recién";
  return eduHoursLabel(minutos);
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA OCUPACIÓN DEL SILLÓN
//
// 🔴 SIN HORARIO NO HAY OCUPACIÓN. Un sillón sin franjas capturadas está
// "siempre abierto" (regla de la Ola 2), y "siempre" no es un denominador:
// dividir entre 24 h × N días daría un 4 % que no significa nada. Esos
// sillones quedan FUERA de la cuenta y la pantalla dice cuántos son — que
// además es la acción concreta que hay que hacer para arreglarlo.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Minutos que ese sillón estuvo ABIERTO durante el periodo.
 * `null` = no se puede saber (no tiene horario capturado).
 */
export function eduDirCapacidadMinutos(
  slots: EduScheduleSlot[],
  weekdayCounts: number[],
): number | null {
  if (!Array.isArray(slots) || slots.length === 0) return null;
  let total = 0;
  for (const s of slots) {
    if (!s) continue;
    const wd = Math.trunc(s.weekday);
    if (wd < 0 || wd > 6) continue;
    const largo = Math.trunc(s.endMinute) - Math.trunc(s.startMinute);
    if (!Number.isFinite(largo) || largo <= 0) continue;
    total += largo * (weekdayCounts[wd] ?? 0);
  }
  return total > 0 ? total : null;
}

/**
 * Ocupación 0..1. `null` cuando no hay capacidad conocida.
 *
 * Se TOPA en 1: un sillón puede tener citas fuera de su horario (la Ola 2
 * lo permite a propósito, el horario propone y no bloquea el pasado), y un
 * "137 % de ocupación" proyectado en una junta es una pregunta que nadie
 * puede contestar. El exceso se ve igual — la barra llega al tope y el
 * detalle enseña las citas.
 */
export function eduDirOcupacion(usadosMin: number, capacidadMin: number | null): number | null {
  if (capacidadMin === null || capacidadMin <= 0) return null;
  const v = usadosMin / capacidadMin;
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(1, v);
}

/** "72 %" o "—". Redondeo a entero: medio punto porcentual no decide nada. */
export function eduDirPctLabel(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)} %`;
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · LA FORMA DE LO QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/** Una cifra grande con la lista que hay detrás. */
export interface EduDirCifra {
  /** Qué lista abre. null = no hay nada que abrir (y entonces no es un
   *  botón: un número que parece pulsable y no lo es se intenta dos veces). */
  detalle: EduDirDetalleKey | null;
  label: string;
  /** Ya formateado (dinero, porcentaje, horas…). */
  value: string;
  /** El número crudo, para el CSV y para ordenar. */
  raw: number;
  note: string;
  semaforo: EduDirSemaforo;
  /** La variación contra el periodo anterior, cuando la hay. */
  variacion: EduDirVariacion | null;
  /**
   * Una SEGUNDA cifra dentro de la misma tarjeta ("iniciados" y
   * "terminados" son la misma pregunta con dos respuestas). Se pinta más
   * chica y ABRE SU PROPIA LISTA: partirla en dos tarjetas rompería el
   * bloque de cuatro, y meterla como texto la dejaría sin poder abrirse.
   */
  sub: EduDirCifra | null;
}

// ── El bloque EN VIVO ───────────────────────────────────────────────────

export interface EduDirSillonVivo {
  chairId: string;
  name: string;
  number: number;
  estado: EduDirSillonEstado;
  appointmentId: string | null;
  patientId: string | null;
  patientName: string | null;
  patientFolio: string | null;
  studentId: string | null;
  studentName: string | null;
  programName: string | null;
  caseId: string | null;
  /** "09:30", hora del instituto. */
  desdeLabel: string | null;
  /** Minutos que lleva esperando una firma. null = no espera nada. */
  esperaMinutos: number | null;
  esperaEtapa: string | null;
  supervisorName: string | null;
  /**
   * El id de **EduUser** del docente que responde por el sillón — el mismo
   * de `supervisorName`, venga de la cita o de la titularidad vigente. Si
   * uno saliera de una fuente y el otro de la otra, el enlace abriría la
   * ficha de un docente distinto del que se lee.
   */
  supervisorId: string | null;
}

export interface EduDirRecepcionFila {
  appointmentId: string;
  /** El id de EduPatient. La sala de espera es de dirección: nada se calla. */
  patientId: string;
  patientName: string;
  patientFolio: string;
  /** El id de **EduStudent** (no el de su cuenta). */
  studentId: string;
  studentName: string;
  programName: string | null;
  chairName: string;
  desdeLabel: string;
  /** Minutos desde que llegó a recepción. */
  esperaMinutos: number | null;
}

export interface EduDirDocenteVivo {
  userId: string;
  name: string;
  sillones: number;
  /** true = no viene de la cita sino del titular VIGENTE del alumno. */
  porTitularidad: boolean;
}

export interface EduDirAhora {
  /** Instante del corte, ISO. La pantalla enseña la hora para que nadie
   *  discuta con un tablero que se quedó pegado. */
  generadoISO: string;
  horaLabel: string;
  pacientesEnClinica: number;
  alumnosAtendiendo: number;
  sillonesEnUso: number;
  sillonesTotal: number;
  docentesResponsables: number;
  /** Sillones ocupados cuyo alumno no tiene NINGÚN docente responsable. */
  sillonesSinDocente: number;
  esperandoFirma: number;
  esperaMasViejaMin: number | null;
  sillones: EduDirSillonVivo[];
  recepcion: EduDirRecepcionFila[];
  docentes: EduDirDocenteVivo[];
}

// ── El periodo ──────────────────────────────────────────────────────────

export interface EduDirEspecialidadRow {
  programId: string;
  programName: string;
  alumnos: number;
  enClinicaHoy: number;
  pacientes: number;
  cobradoCents: number;
  /** 0..1. Σ requisitos cumplidos / Σ requisitos del plan. null = no se
   *  puede saber (sin requisitos capturados). */
  avance: number | null;
  /** Lo que se esperaría a esta altura del ciclo, 0..1. */
  esperado: number | null;
  estado: EduAtrasoEstado | null;
  motivo: string;
}

export interface EduDirAlumnoRow {
  studentId: string;
  studentName: string;
  matricula: string;
  programName: string;
  pacientes: number;
  citas: number;
  horasLabel: string;
  estado: EduAtrasoEstado | null;
  motivo: string;
}

export interface EduDirDinero {
  /** Cobrado DE VERDAD: pagos menos devoluciones, por fecha de pago. */
  cobradoCents: number;
  cobradoPrevCents: number;
  /** Lo EMITIDO en el periodo (los tickets), que no es lo mismo. */
  emitidoCents: number;
  pendienteCents: number;
  cobros: number;
  /** Emitido a pacientes que llegaron solos a la clínica. */
  publicoCents: number;
  /** Emitido a pacientes que trajo un alumno. */
  alumnoCents: number;
  /** 🔴 EL CONTROL: tarifa de alumno aplicada a un paciente que llegó solo. */
  controlCents: number;
  controlCount: number;
  /** El caso inverso: paciente de alumno cobrado con la lista general. */
  inversoCents: number;
  inversoCount: number;
  /** Cobros sin lista guardada: no se pueden clasificar y se dice. */
  sinListaCents: number;
  sinListaCount: number;
  ticketPromedioCents: number | null;
  /** Cobrado ÷ sillones activos. null = no hay sillones dados de alta. */
  porSillonCents: number | null;
  sillonesActivos: number;
}

export interface EduDirPendientes {
  firmas: number;
  firmaMasViejaMin: number | null;
  pacientesSinAlumno: number;
  calificacionesSinRegistrar: number;
  alumnosSinDocente: number;
}

export interface EduDirSillonUso {
  chairId: string;
  name: string;
  number: number;
  usadosMin: number;
  capacidadMin: number | null;
  ocupacion: number | null;
  citas: number;
}

export interface EduDirUso {
  ocupacion: number | null;
  usadosMin: number;
  capacidadMin: number | null;
  libresMin: number | null;
  sillonesSinHorario: number;
  citasPerdidas: number;
  noShow: number;
  canceladas: number;
  duracionPromedioMin: number | null;
  sillones: EduDirSillonUso[];
}

export interface EduDirPanel {
  ventana: EduDirVentana;
  institucion: string;
  /**
   * Ola 11 · LA SEDE que se esta mirando, o `null` en la vista
   * consolidada. Va en el tablero y en el CSV: un archivo de acreditacion
   * que dice el nombre del instituto y trae las cifras de UN campus es
   * exactamente el dato falso que este vertical no admite.
   */
  sede: string | null;
  /** La especialidad elegida, si hay una. Viaja al cliente para poder
   *  rearmar la URL sin volver a leer los searchParams. */
  especialidadId: string | null;
  especialidadNombre: string | null;
  tarjetas: EduDirCifra[];
  /**
   * Las especialidades del instituto para el SELECTOR. Van completas
   * aunque haya una filtrada: si el selector solo trajera la elegida, no
   * habria forma de volver a otra sin borrar el parametro a mano.
   */
  opciones: { id: string; name: string }[];
  especialidades: EduDirEspecialidadRow[];
  /** La fila de lo que no se pudo atribuir a una especialidad. */
  cobradoSinCaso: number;
  masActivos: EduDirAlumnoRow[];
  atrasados: EduDirAlumnoRow[];
  dinero: EduDirDinero;
  pendientes: EduDirPendientes;
  uso: EduDirUso;
  /** Todo lo que la pantalla tiene que CONFESAR: topes alcanzados, datos
   *  que no se pueden calcular, sillones sin horario. */
  avisos: string[];
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LAS LISTAS QUE HAY DETRÁS DE CADA CIFRA
//
// 🔴 UN NÚMERO QUE NO SE PUEDE ABRIR NO SIRVE PARA DECIDIR. "Hay 7 casos
// esperando firma" no es accionable; "estos siete, el más viejo lleva 2 h"
// sí. Cada cifra del panel apunta a una de estas keys, y el endpoint
// /api/instituto/direccion/detalle las resuelve con el MISMO alcance y los
// MISMOS filtros que la pantalla.
//
// Las listas que el panel ya tiene en memoria (los sillones, la tabla por
// especialidad, los alumnos) NO están aquí: se abren sin pedirle nada al
// servidor.
// ═══════════════════════════════════════════════════════════════════════

export const EDU_DIR_DETALLE_KEYS = [
  "pacientes-atendidos",
  "citas-completadas",
  "tamizajes",
  "citas-perdidas",
  "casos-abiertos",
  "casos-cerrados",
  "calificaciones-pendientes",
  "cobros",
  "cobrado-publico",
  "cobrado-alumno",
  "control-tarifa",
  "control-inverso",
  "pendiente-cobro",
  "firmas-pendientes",
  "pacientes-sin-alumno",
  "alumnos-sin-docente",
] as const;

export type EduDirDetalleKey = (typeof EDU_DIR_DETALLE_KEYS)[number];

export function parseEduDirDetalle(raw: unknown): EduDirDetalleKey | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return (EDU_DIR_DETALLE_KEYS as readonly string[]).includes(v) ? (v as EduDirDetalleKey) : null;
}

export const EDU_DIR_DETALLE_TITULOS: Record<EduDirDetalleKey, string> = {
  "pacientes-atendidos": "Pacientes atendidos",
  "citas-completadas": "Citas terminadas",
  tamizajes: "Valoraciones",
  "citas-perdidas": "Citas perdidas",
  "casos-abiertos": "Tratamientos iniciados",
  "casos-cerrados": "Tratamientos terminados",
  "calificaciones-pendientes": "Casos terminados sin calificar",
  cobros: "Cobros emitidos",
  "cobrado-publico": "Cobros a pacientes que llegaron solos",
  "cobrado-alumno": "Cobros a pacientes que trajo un estudiante",
  "control-tarifa": "Tarifa de estudiante a paciente que llegó solo",
  "control-inverso": "Paciente de estudiante cobrado con la lista general",
  "pendiente-cobro": "Cobros con saldo",
  "firmas-pendientes": "Casos esperando firma",
  "pacientes-sin-alumno": "Pacientes sin estudiante",
  "alumnos-sin-docente": "Estudiantes sin docente",
};

/** Lo que se lee bajo el título del detalle: qué es exactamente esta lista. */
export const EDU_DIR_DETALLE_DETALLES: Record<EduDirDetalleKey, string> = {
  "pacientes-atendidos":
    "Personas distintas con al menos una cita TERMINADA en el periodo. Quien vino tres veces cuenta una.",
  "citas-completadas": "Las citas que se marcaron como terminadas dentro del periodo.",
  tamizajes: "Las valoraciones iniciales terminadas en el periodo: por ahí entra un paciente nuevo.",
  "citas-perdidas":
    "Citas canceladas y pacientes que no llegaron. Un hueco que se pudo haber usado.",
  "casos-abiertos": "Casos que se abrieron dentro del periodo, con su especialidad y su estudiante.",
  "casos-cerrados": "Casos que se cerraron como terminados dentro del periodo.",
  "calificaciones-pendientes":
    "Casos terminados en el periodo que todavía no tienen calificación vigente. Es trabajo del docente que falta cerrar.",
  cobros: "Los tickets emitidos en el periodo, con lo que se cobró y lo que queda debiendo.",
  "cobrado-publico":
    "Cobros de pacientes SIN estudiante de origen: llegaron solos a la clínica.",
  "cobrado-alumno": "Cobros de pacientes que trajo un estudiante.",
  "control-tarifa":
    "El control que importa: se aplicó una lista de precios de PACIENTE DE ESTUDIANTE a alguien que llegó solo a la clínica. O falta marcar quién lo trajo, o se cobró de menos.",
  "control-inverso":
    "Al revés: el paciente sí lo trajo un estudiante y se le cobró con la lista general. O se le cobró de más, o el origen se marcó después del cobro.",
  "pendiente-cobro": "Cobros del periodo que todavía tienen saldo.",
  "firmas-pendientes":
    "Autorizaciones que un docente todavía no ha decidido, de la más vieja a la más nueva.",
  "pacientes-sin-alumno":
    "Registrados y sin caso abierto ni cita próxima: no son de nadie todavía, y por eso no los ve ningún estudiante ni ningún docente.",
  "alumnos-sin-docente":
    "Estudiantes activos sin ninguna asignación de supervisor VIGENTE. Nadie puede firmarles una autorización.",
};

/** Una fila de detalle: genérica a propósito, para que el modal sea UNO. */
export interface EduDirDetalleFila {
  id: string;
  /** Lo primero que se lee (el nombre del paciente, el folio del cobro…). */
  titulo: string;
  /**
   * Cuando el propio `titulo` ES una persona con ficha propia — un docente
   * en una lista que no tenía otro destino, por ejemplo—: FilaDetalle lo
   * pinta con EduPersonaLink en vez de un `<Link href>` a `href`, y es
   * EduPersonaLink quien construye la URL — nunca a mano, y nunca sin pasar
   * por el permiso de quien mira. Gana sobre `href` cuando los dos vienen.
   */
  tituloPersona?: { kind: EduPersonaKind; id: string } | null;
  /** La segunda línea. */
  sub: string | null;
  /**
   * Cuando el NOMBRE de una persona vive dentro de `sub` —el estudiante o
   * el docente que casi nunca llegan a `titulo`—: se saca de ahí y `sub` se
   * queda con el RESTO del texto, SIN el nombre, para no repetirlo.
   * FilaDetalle pinta el nombre con EduPersonaLink delante y `sub` después.
   * Sin subPersona, `sub` se pinta tal cual, como siempre: nada de
   * regresiones en las filas que no tienen persona.
   */
  subPersona?: { kind: EduPersonaKind; id: string; nombre: string } | null;
  /** Hasta tres pares dato/valor, ya formateados. */
  campos: { k: string; v: string }[];
  /** Adónde lleva tocar el título, dentro del panel. null = no lleva a nada.
   *  Se ignora cuando hay `tituloPersona`. */
  href: string | null;
  /** Color de la fila cuando la lista es un control. */
  semaforo: EduDirSemaforo;
}

export interface EduDirDetallePage {
  key: EduDirDetalleKey;
  titulo: string;
  detalle: string;
  filas: EduDirDetalleFila[];
  total: number;
  truncated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 9 · LA EXPORTACIÓN
//
// CSV, igual que la bitácora de la Ola 6 y por lo mismo: en una
// acreditación esto se pega en una hoja de cálculo y se suma. Se reusan
// `eduCsvCell`/`eduCsvRow`/`eduCsvFile` de evaluacion-core —incluidos el
// BOM y el apóstrofo que impide que una celda se convierta en fórmula de
// Excel—; una segunda implementación del escapado sería un segundo sitio
// donde equivocarse.
//
// El PAPEL se resuelve aparte, con @media print sobre la propia pantalla:
// un PDF generado sería una tercera versión del mismo tablero.
// ═══════════════════════════════════════════════════════════════════════

/**
 * El nombre del archivo.
 *
 * NO se reusa `eduCsvFileName` de evaluacion-core y no es un descuido: esa
 * función lleva el prefijo "bitacora-" cableado, y un panel de dirección
 * que se descarga como "bitacora-…" es el archivo que nadie encuentra en
 * la carpeta de descargas el día de la acreditación. Cambiarle el prefijo
 * a la de la Ola 6 obligaría a tocar su llamada y su prueba por una razón
 * cosmética de esta ola.
 */
export function eduDirCsvFileName(desdeISO: string, hastaISO: string): string {
  const limpio = (v: string): string => (parseEduDayISO(v) ?? "").replace(/[^0-9-]/g, "");
  const a = limpio(desdeISO) || "periodo";
  const b = limpio(hastaISO) || "periodo";
  return a === b
    ? `panel-direccion-${a}.csv`
    : `panel-direccion-${a}_${b}.csv`;
}

export function buildEduDireccionCsv(panel: EduDirPanel, ahora: EduDirAhora | null): string {
  const filas: string[] = [];

  filas.push(eduCsvRow(["DaleControl Institucional — Panel de dirección"]));
  filas.push(eduCsvRow(["Instituto", panel.institucion]));
  filas.push(eduCsvRow(["Sede", panel.sede ?? "Todas las sedes"]));
  filas.push(eduCsvRow(["Periodo", panel.ventana.label]));
  filas.push(eduCsvRow(["Comparado", panel.ventana.compara]));
  filas.push(eduCsvRow(["Especialidad", panel.especialidadNombre ?? "Todas"]));
  filas.push(eduCsvRow([]));

  if (ahora) {
    filas.push(eduCsvRow(["LA CLÍNICA AHORA", `corte de las ${ahora.horaLabel}`]));
    filas.push(eduCsvRow(["Concepto", "Valor"]));
    filas.push(eduCsvRow(["Pacientes en la clínica", ahora.pacientesEnClinica]));
    filas.push(eduCsvRow(["Estudiantes atendiendo", ahora.alumnosAtendiendo]));
    filas.push(
      eduCsvRow(["Sillones en uso", `${ahora.sillonesEnUso} de ${ahora.sillonesTotal}`]),
    );
    filas.push(eduCsvRow(["Docentes responsables", ahora.docentesResponsables]));
    filas.push(eduCsvRow(["Esperando firma", ahora.esperandoFirma]));
    filas.push(eduCsvRow([]));

    filas.push(eduCsvRow(["SILLONES"]));
    filas.push(
      eduCsvRow(["Sillón", "Estado", "Paciente", "Estudiante", "Especialidad", "Desde", "Espera"]),
    );
    for (const s of ahora.sillones) {
      filas.push(
        eduCsvRow([
          `${s.number} · ${s.name}`,
          EDU_DIR_SILLON_LABELS[s.estado],
          s.patientName ?? "",
          s.studentName ?? "",
          s.programName ?? "",
          s.desdeLabel ?? "",
          s.esperaMinutos === null ? "" : eduDirEsperaLabel(s.esperaMinutos),
        ]),
      );
    }
    filas.push(eduCsvRow([]));
  }

  filas.push(eduCsvRow(["ACTIVIDAD DEL PERIODO"]));
  filas.push(eduCsvRow(["Concepto", "Valor", "Periodo anterior", "Variación"]));
  for (const t of panel.tarjetas) {
    for (const c of [t, t.sub]) {
      if (!c) continue;
      filas.push(
        eduCsvRow([
          c.label,
          c.value,
          c.variacion ? c.raw - c.variacion.delta : "",
          c.variacion ? c.variacion.texto : "",
        ]),
      );
    }
  }
  filas.push(eduCsvRow([]));

  filas.push(eduCsvRow(["POR ESPECIALIDAD"]));
  filas.push(
    eduCsvRow([
      "Especialidad",
      "Estudiantes",
      "En clínica hoy",
      "Pacientes",
      "Cobrado",
      "Avance del ciclo",
      "Esperado",
      "Estado",
      "Motivo",
    ]),
  );
  for (const e of panel.especialidades) {
    filas.push(
      eduCsvRow([
        e.programName,
        e.alumnos,
        e.enClinicaHoy,
        e.pacientes,
        eduMoney(e.cobradoCents),
        eduDirPctLabel(e.avance),
        eduDirPctLabel(e.esperado),
        eduDirAtrasoLabel(e.estado),
        e.motivo,
      ]),
    );
  }
  if (panel.cobradoSinCaso > 0) {
    filas.push(
      eduCsvRow([
        "Sin caso (no se puede atribuir)",
        "",
        "",
        "",
        eduMoney(panel.cobradoSinCaso),
        "",
        "",
        "",
        "Caja cobra sin abrir expediente: un cobro solo tiene especialidad si trae caso.",
      ]),
    );
  }
  filas.push(eduCsvRow([]));

  filas.push(eduCsvRow(["ESTUDIANTES ATRASADOS"]));
  filas.push(eduCsvRow(["Matrícula", "Estudiante", "Especialidad", "Estado", "Motivo"]));
  for (const a of panel.atrasados) {
    filas.push(
      eduCsvRow([a.matricula, a.studentName, a.programName, eduDirAtrasoLabel(a.estado), a.motivo]),
    );
  }
  filas.push(eduCsvRow([]));

  filas.push(eduCsvRow(["ESTUDIANTES CON MÁS ACTIVIDAD"]));
  filas.push(eduCsvRow(["Matrícula", "Estudiante", "Especialidad", "Pacientes", "Citas", "Horas"]));
  for (const a of panel.masActivos) {
    filas.push(
      eduCsvRow([a.matricula, a.studentName, a.programName, a.pacientes, a.citas, a.horasLabel]),
    );
  }
  filas.push(eduCsvRow([]));

  const d = panel.dinero;
  filas.push(eduCsvRow(["DINERO"]));
  filas.push(eduCsvRow(["Concepto", "Importe", "Cuántos"]));
  filas.push(eduCsvRow(["Cobrado (pagos netos del periodo)", eduMoney(d.cobradoCents), ""]));
  filas.push(eduCsvRow(["Emitido (tickets del periodo)", eduMoney(d.emitidoCents), d.cobros]));
  filas.push(eduCsvRow(["Pendiente de cobro", eduMoney(d.pendienteCents), ""]));
  filas.push(eduCsvRow(["Emitido · llegaron solos", eduMoney(d.publicoCents), ""]));
  filas.push(eduCsvRow(["Emitido · los trajo un estudiante", eduMoney(d.alumnoCents), ""]));
  filas.push(
    eduCsvRow([
      "CONTROL · tarifa de estudiante a paciente que llegó solo",
      eduMoney(d.controlCents),
      d.controlCount,
    ]),
  );
  filas.push(
    eduCsvRow([
      "CONTROL · paciente de estudiante con lista general",
      eduMoney(d.inversoCents),
      d.inversoCount,
    ]),
  );
  filas.push(eduCsvRow(["Sin lista guardada", eduMoney(d.sinListaCents), d.sinListaCount]));
  filas.push(
    eduCsvRow([
      "Ticket promedio",
      d.ticketPromedioCents === null ? "" : eduMoney(d.ticketPromedioCents),
      "",
    ]),
  );
  filas.push(
    eduCsvRow([
      `Ingreso por sillón (${d.sillonesActivos} activos)`,
      d.porSillonCents === null ? "" : eduMoney(d.porSillonCents),
      "",
    ]),
  );
  filas.push(eduCsvRow([]));

  filas.push(eduCsvRow(["PENDIENTES"]));
  filas.push(eduCsvRow(["Concepto", "Cuántos", "Nota"]));
  filas.push(
    eduCsvRow([
      "Casos esperando firma",
      panel.pendientes.firmas,
      panel.pendientes.firmaMasViejaMin === null
        ? ""
        : `el más viejo lleva ${eduDirEsperaLabel(panel.pendientes.firmaMasViejaMin)}`,
    ]),
  );
  filas.push(eduCsvRow(["Pacientes sin estudiante", panel.pendientes.pacientesSinAlumno, ""]));
  filas.push(
    eduCsvRow(["Calificaciones sin registrar", panel.pendientes.calificacionesSinRegistrar, ""]),
  );
  filas.push(eduCsvRow(["Estudiantes sin docente", panel.pendientes.alumnosSinDocente, ""]));
  filas.push(eduCsvRow([]));

  filas.push(eduCsvRow(["USO DE LA CLÍNICA"]));
  filas.push(eduCsvRow(["Concepto", "Valor"]));
  filas.push(eduCsvRow(["Ocupación promedio", eduDirPctLabel(panel.uso.ocupacion)]));
  filas.push(eduCsvRow(["Horas de sillón usadas", eduHoursLabel(panel.uso.usadosMin)]));
  filas.push(
    eduCsvRow([
      "Horas de sillón sin usar",
      panel.uso.libresMin === null ? "no se puede saber" : eduHoursLabel(panel.uso.libresMin),
    ]),
  );
  filas.push(eduCsvRow(["Sillones sin horario capturado", panel.uso.sillonesSinHorario]));
  filas.push(eduCsvRow(["Citas perdidas", panel.uso.citasPerdidas]));
  filas.push(
    eduCsvRow([
      "Duración promedio de una cita",
      panel.uso.duracionPromedioMin === null
        ? "—"
        : eduHoursLabel(panel.uso.duracionPromedioMin),
    ]),
  );
  filas.push(eduCsvRow([]));

  filas.push(eduCsvRow(["SILLÓN A SILLÓN"]));
  filas.push(eduCsvRow(["Sillón", "Citas", "Horas usadas", "Horas abiertas", "Ocupación"]));
  for (const s of panel.uso.sillones) {
    filas.push(
      eduCsvRow([
        `${s.number} · ${s.name}`,
        s.citas,
        eduHoursLabel(s.usadosMin),
        s.capacidadMin === null ? "sin horario" : eduHoursLabel(s.capacidadMin),
        eduDirPctLabel(s.ocupacion),
      ]),
    );
  }

  if (panel.avisos.length > 0) {
    filas.push(eduCsvRow([]));
    filas.push(eduCsvRow(["AVISOS"]));
    for (const a of panel.avisos) filas.push(eduCsvRow([a]));
  }

  return eduCsvFile(filas);
}

// ═══════════════════════════════════════════════════════════════════════
// 10 · LAS SERIES POR DÍA — el INICIO de la DIRECCIÓN
//
// 🔴 POR QUÉ VIVEN AQUÍ Y NO EN UN MÓDULO NUEVO DEL INICIO.
//
// El Inicio de dirección pinta tres gráficas —pacientes atendidos, dinero
// cobrado y tratamientos autorizados, día a día— y las tres son preguntas
// que este archivo YA contesta, partidas por día. Escribirlas aparte, con
// su propia ventana, su propio `where` y su propia idea de qué es
// "cobrado", es exactamente cómo se llega a que el Inicio diga $84 300 y
// Dirección diga $84 900 el mismo martes: a partir de ahí no se puede usar
// ninguna de las dos.
//
// Así que se reusa TODO: la misma ventana (eduDirVentana), los mismos
// topes (EDU_DIR_MAX_*), la misma variación (eduDirVariacion) y el mismo
// alcance (el de direccion.ts, que sale de visibility.ts). Lo único nuevo
// es el reparto por día, que es lo que se prueba aquí abajo sin base.
//
// 🔴 TODOS LOS DÍAS DEL PERIODO, INCLUIDOS LOS DE CERO. Una serie armada
// solo con los días que tuvieron filas pega el viernes con el lunes y
// dibuja una clínica que trabaja siete días. Los días salen del
// calendario y los datos se les cuelgan encima.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los dos periodos del conmutador del Inicio: SEMANA y MES.
 *
 * No están "hoy" ni "rango", y no es un olvido. "Hoy" es UN día: una
 * gráfica de una barra no es una gráfica, es un número con adorno. Y el
 * rango personalizado es una herramienta de análisis que ya vive en el
 * tablero de Dirección con su exportación al lado; el Inicio es la
 * pantalla que se abre al llegar por la mañana, y ahí elegir dos fechas
 * sobra.
 */
export const EDU_DIR_INICIO_PERIODOS = ["semana", "mes"] as const;

export type EduDirInicioPeriodo = (typeof EDU_DIR_INICIO_PERIODOS)[number];

/** Con qué periodo abre el Inicio. */
export const EDU_DIR_INICIO_PERIODO_DEFAULT: EduDirInicioPeriodo = "semana";

/**
 * Lee el conmutador de la URL.
 *
 * Comparte el nombre del parámetro con el tablero de Dirección
 * (`?periodo=`) a propósito, para que pasar de una pantalla a otra no
 * cambie de qué se está hablando. Y por eso mismo hace falta esta
 * función: "hoy" y "rango" son valores LEGALES allí, y aquí dejarían una
 * gráfica de una sola barra. Cualquier cosa que no sea "mes" cae en
 * "semana".
 */
export function parseEduDirInicioPeriodo(raw: unknown): EduDirInicioPeriodo {
  return parseEduDirPeriodo(raw) === "mes" ? "mes" : "semana";
}

/** Las tres gráficas. El orden es el de la pantalla. */
export const EDU_DIR_SERIE_KEYS = ["pacientes", "cobrado", "autorizaciones"] as const;

export type EduDirSerieKey = (typeof EDU_DIR_SERIE_KEYS)[number];

/** Un día de una serie. En la serie "cobrado", `value` son CENTAVOS. */
export interface EduDirSeriePunto {
  dayISO: string;
  /** "lun 31 ago" — lo que va debajo de la barra. */
  label: string;
  /** "lunes 31 de agosto de 2026" — lo que dice el globo al pasar encima. */
  largo: string;
  value: number;
}

export interface EduDirSerie {
  key: EduDirSerieKey;
  titulo: string;
  /** Qué se cuenta EXACTAMENTE. Va bajo el título, a la vista. */
  detalle: string;
  /** "dinero" se pinta con eduMoney; "conteo", con el número pelón. */
  unidad: "conteo" | "dinero";
  puntos: EduDirSeriePunto[];
  total: number;
  /** El total ya formateado según la unidad. */
  totalLabel: string;
  /** El mismo total, del periodo anterior. */
  anterior: number;
  variacion: EduDirVariacion;
  /** El día más alto. 0 = la serie entera está en cero. */
  maximo: number;
  /**
   * Lo que esta serie tiene que CONFESAR: que las barras no suman el
   * total (pacientes), o que la sede elegida no la recorta
   * (autorizaciones). Cadena vacía = no hay nada que advertir.
   */
  nota: string;
}

/**
 * Los días del periodo, TODOS, del primero al último.
 *
 * Recortados por EDU_DIR_MAX_DIAS, que es el mismo tope de la ventana: dos
 * topes distintos para lo mismo serían un día que sale en la gráfica y no
 * en el total.
 */
export function eduDirDiasDeVentana(desdeISO: string, dias: number): string[] {
  const n = Math.max(0, Math.min(Math.trunc(dias), EDU_DIR_MAX_DIAS));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(eduShiftDayISO(desdeISO, i));
  return out;
}

/**
 * En qué día del calendario DEL INSTITUTO cae un instante.
 *
 * 🔴 La zona sale del instituto y no del servidor, por lo mismo que la
 * ventana: en México un pago de las 19:00 es de HOY, y leído en UTC caería
 * en la barra de mañana. Un instante ilegible devuelve `null` y su fila no
 * se cuenta en NINGÚN día — antes eso que meterla en el equivocado.
 */
export function eduDirDiaDe(instante: Date | null | undefined, timeZone: string): string | null {
  if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) return null;
  return eduUtcToZoned(instante, eduSafeTimeZone(timeZone)).dayISO;
}

/**
 * La etiqueta que va DEBAJO de la barra: "mar 25".
 *
 * Corta a propósito, y no `eduFormatDayShort` ("mar 25 de ago"): con 30
 * barras el eje solo rotula una de cada cuatro, y una etiqueta larga se
 * pisa con la siguiente en cuanto la ventana se estrecha. El mes ya está
 * en el encabezado del periodo ("2 ago – 31 ago") y la fecha COMPLETA la
 * dice el globo del ratón, que es donde se comprueba.
 */
export function eduDirEtiquetaDeDia(dayISO: string): string {
  const limpio = parseEduDayISO(dayISO);
  if (!limpio) return "—";
  const dia = Number(limpio.slice(8, 10));
  return `${EDU_WEEKDAY_SHORT[eduWeekdayOf(limpio)]} ${dia}`;
}

/**
 * La variación EN LA UNIDAD DE LA SERIE.
 *
 * 🔴 `eduDirVariacion` es genérica y escribe los dos extremos como números
 * pelados: en dinero eso saca "(0 → 842300)", que se lee como ochocientos
 * cuarenta y dos mil pesos cuando son ocho mil cuatrocientos veintitrés.
 * La ARITMÉTICA no cambia —sigue siendo la misma función, con su regla de
 * no inventar un porcentaje contra cero—; lo único que cambia es cómo se
 * escriben esos dos números.
 */
export function eduDirVariacionEn(
  actual: number,
  anterior: number,
  unidad: "conteo" | "dinero",
): EduDirVariacion {
  const v = eduDirVariacion(actual, anterior);
  if (unidad !== "dinero") return v;

  const a = Number.isFinite(actual) ? actual : 0;
  const b = Number.isFinite(anterior) ? anterior : 0;
  if (v.pct === null) {
    return {
      ...v,
      texto:
        a === 0 && b === 0
          ? "igual que antes: nada en los dos periodos"
          : `antes no entró nada (${eduMoney(b)} → ${eduMoney(a)})`,
    };
  }
  const signo = v.pct > 0 ? "+" : "";
  return { ...v, texto: `${signo}${v.pct} % (${eduMoney(b)} → ${eduMoney(a)})` };
}

/**
 * Los puntos de una serie: los días del calendario con sus valores encima.
 *
 * `valores` es día → valor. Un día sin entrada vale CERO y se pinta igual:
 * es la diferencia entre "ese domingo no vino nadie" y "ese domingo no
 * existe", y la segunda no es verdad.
 *
 * Una clave que cae FUERA del periodo se ignora en silencio a propósito:
 * quien la mete es una fila cuyo `where` ya la acotó, así que si aparece
 * es un instante de borde leído en otra zona — y sumarlo al primer o al
 * último día correría el total de ese día.
 */
export function eduDirPuntosPorDia(
  desdeISO: string,
  dias: number,
  valores: Map<string, number> | null | undefined,
): EduDirSeriePunto[] {
  return eduDirDiasDeVentana(desdeISO, dias).map((dayISO) => ({
    dayISO,
    label: eduDirEtiquetaDeDia(dayISO),
    largo: eduFormatDayLong(dayISO),
    value: valores?.get(dayISO) ?? 0,
  }));
}

/** La suma de una serie. */
export function eduDirSumaPuntos(puntos: EduDirSeriePunto[] | null | undefined): number {
  let total = 0;
  for (const p of puntos ?? []) total += Number.isFinite(p?.value) ? p.value : 0;
  return total;
}

/** El día más alto de una serie. 0 si está toda en cero (o vacía). */
export function eduDirMaximoPuntos(puntos: EduDirSeriePunto[] | null | undefined): number {
  let max = 0;
  for (const p of puntos ?? []) {
    const v = Number.isFinite(p?.value) ? p.value : 0;
    if (v > max) max = v;
  }
  return max;
}

/**
 * Arma una serie completa.
 *
 * 🔴 EL TOTAL SE PASA, NO SE DEDUCE DE LAS BARRAS, y ése es el argumento
 * que existe para no equivocarse: en dinero y en autorizaciones el total
 * ES la suma de los días, pero en PACIENTES no lo es. Esa cifra cuenta
 * personas DISTINTAS, así que quien vino el lunes y el jueves suma 1 en el
 * lunes, 1 en el jueves y 1 en el total. Deducir el total sumando las
 * barras diría 2 y contradiría al tablero de Dirección, que dice 1.
 */
export function eduDirArmarSerie(input: {
  key: EduDirSerieKey;
  titulo: string;
  detalle: string;
  unidad: "conteo" | "dinero";
  puntos: EduDirSeriePunto[];
  total: number;
  anterior: number;
  nota?: string;
}): EduDirSerie {
  const puntos = input.puntos ?? [];
  const total = Number.isFinite(input.total) ? input.total : 0;
  const anterior = Number.isFinite(input.anterior) ? input.anterior : 0;
  return {
    key: input.key,
    titulo: input.titulo,
    detalle: input.detalle,
    unidad: input.unidad,
    puntos,
    total,
    totalLabel: input.unidad === "dinero" ? eduMoney(total) : String(total),
    anterior,
    variacion: eduDirVariacionEn(total, anterior, input.unidad),
    maximo: eduDirMaximoPuntos(puntos),
    nota: input.nota ?? "",
  };
}

/**
 * El semáforo de la bandeja de firmas, con el MISMO umbral que el tablero
 * de Dirección (EDU_DIR_FIRMA_VIEJA_MIN), importado y no copiado.
 *
 * Sin nada pendiente es NEUTRO y no OK: "no hay autorizaciones esperando"
 * no es un logro que merezca un verde, es el estado normal de una tarde
 * cualquiera. El color de esta pantalla se reserva para lo que de verdad
 * se juzga — la misma regla que ya sigue el tablero.
 */
export function eduDirSemaforoDeFirmas(
  pendientes: number,
  masViejaMin: number | null,
): EduDirSemaforo {
  if (!Number.isFinite(pendientes) || pendientes <= 0) return "NEUTRO";
  if (masViejaMin !== null && Number.isFinite(masViejaMin) && masViejaMin >= EDU_DIR_FIRMA_VIEJA_MIN) {
    return "ACTUAR";
  }
  return "VIGILAR";
}

/** Un acceso del bloque "lo que está esperando". */
export interface EduDirInicioAcceso {
  key: "firmas" | "citas-hoy" | "por-cobrar";
  titulo: string;
  /** El número ya formateado (dinero incluido). */
  valor: string;
  raw: number;
  /** Qué es y qué se espera de quien lo lee. */
  detalle: string;
  /** Adónde lleva. Es la pantalla donde eso se resuelve, no un informe. */
  href: string;
  semaforo: EduDirSemaforo;
}

/** Lo que el Inicio de dirección le manda a la pantalla. */
export interface EduDirInicio {
  ventana: EduDirVentana;
  periodo: EduDirInicioPeriodo;
  institucion: string;
  /** La sede elegida, o `null` en el consolidado del instituto. */
  sede: string | null;
  series: EduDirSerie[];
  esperando: EduDirInicioAcceso[];
  /** Topes alcanzados y todo lo que este tablero no puede saber. */
  avisos: string[];
}

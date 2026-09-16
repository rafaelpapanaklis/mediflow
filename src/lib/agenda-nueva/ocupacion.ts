/**
 * OCUPACIÓN DEL DÍA — la barra del Mes y el contador de la Semana (WS1-T2).
 *
 * ─── Por qué no está el «30 citas» del prototipo ───────────────────────────
 * El README del diseño dice que la capacidad de un día son «30 citas de lunes
 * a viernes y 15 el sábado, escalado por los responsables visibles». Ese
 * número es del PROTOTIPO: sale de tres doctores inventados con una agenda
 * inventada, y no tiene nada que ver con la clínica que abre la pantalla. Un
 * porcentaje de ocupación falso es peor que no enseñar ninguno — el dueño lo
 * lee para decidir si contrata, si abre el sábado o si mete otro sillón.
 *
 * El sistema SÍ sabe la capacidad de verdad, y de hecho ya la calcula así en
 * las cabeceras de columna de la vista Día (`occupancyOf` en
 * agenda-page-client.tsx): minutos realmente ocupados ÷ minutos disponibles.
 * Aquí se usa la MISMA definición, con dos diferencias obligadas por la vista:
 *
 *  - Los minutos disponibles de CADA día salen de `ClinicSchedule` —la tabla
 *    que Ajustes edita, con `enabled` + `openTime`/`closeTime` por día de la
 *    semana—, no de la ventana que el eje pinta. El Mes abarca 42 días con
 *    horarios distintos: el sábado casi siempre cierra antes, y el domingo
 *    entero suele estar cerrado.
 *  - Se multiplican por los CARRILES visibles (un carril = una columna de la
 *    vista Día: el responsable, o el sillón si la clínica trabaja «por
 *    sillón»). Así el filtro de doctores/unidades cambia el porcentaje igual
 *    que cambia lo que se ve, que es lo que hace el prototipo al escalar por
 *    responsables visibles.
 *
 * Si la clínica NO tiene horario configurado en Ajustes, no nos lo inventamos:
 * `porcentaje` sale `null`, la vista enseña el número de citas y esconde la
 * barra. Lo mismo si el filtro deja cero carriles.
 *
 * ─── Qué cuenta y qué no ──────────────────────────────────────────────────
 *  - CANCELLED no cuenta para nada: ni en «N citas», ni en los minutos, ni en
 *    los segmentos. Una cita cancelada liberó su hueco.
 *  - NO_SHOW cuenta en «N citas» (se agendó y ocupó un renglón de la agenda)
 *    pero NO en los minutos ocupados, para no contradecir al `occupancyOf` de
 *    las cabeceras de la vista Día: dos porcentajes distintos del mismo día en
 *    la misma pantalla se leen como un error, no como un matiz.
 *  - El porcentaje NO se recorta a 100. Un día sobrevendido tiene que poder
 *    decir «112% ocupado»; es información real y es justo la que se esconde al
 *    recortar. Lo que sí se normaliza son los anchos de los segmentos, para
 *    que la barra no se salga de su caja.
 *
 * Sin React a propósito: esto se prueba con `npm run test:agenda-ocupacion`.
 */
import { getTzParts } from "@/lib/agenda/time-utils";
import type { ScheduleDay } from "@/lib/agenda/clinic-hours";
import { scheduleDayOfISO } from "@/lib/agenda/clinic-hours";
import type { AppointmentStatus } from "@/lib/agenda/types";

/** Lo mínimo que la ocupación necesita saber de una cita. */
export interface CitaOcupacion {
  startsAt: string;
  endsAt?: string | null;
  status: AppointmentStatus;
  /** Id del responsable (doctor) — `appt.doctor?.id`. */
  doctorId?: string | null;
  resourceId?: string | null;
}

/** Un carril de capacidad: una columna de la vista Día. */
export interface Carril {
  id: string;
  nombre: string;
  color: string;
}

/** El horario REAL de un día concreto, leído de `ClinicSchedule`. */
export interface HorarioDia {
  /** `enabled` del día. `false` = la clínica no abre. */
  abierto: boolean;
  /** Minutos desde medianoche. `null` cuando el día está cerrado. */
  aperturaMin: number | null;
  cierreMin: number | null;
}

export interface SegmentoOcupacion {
  carrilId: string;
  nombre: string;
  color: string;
  minutos: number;
  /** Fracción 0..1 de la barra, ya normalizada para que la suma no pase de 1. */
  fraccion: number;
}

export interface OcupacionDia {
  dayISO: string;
  /** El horario dice que la clínica no abre ese día. */
  cerrado: boolean;
  /** No hay `ClinicSchedule` utilizable: no sabemos el horario, no inventamos. */
  horarioDesconocido: boolean;
  /** Citas agendadas (sin las canceladas). */
  totalCitas: number;
  /** Cuántas siguen en SCHEDULED — la nota «N sin confirmar» del diseño. */
  sinConfirmar: number;
  minutosOcupados: number;
  minutosDisponibles: number;
  /** `null` = no se puede calcular de verdad. NO se recorta a 100. */
  porcentaje: number | null;
  segmentos: SegmentoOcupacion[];
}

function parseHHMM(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) && mins >= 0 && mins <= 24 * 60 ? mins : null;
}

/** Las filas de `ClinicSchedule` que sirven para algo (horas legibles y cierre > apertura). */
function filasUtiles(schedules: ScheduleDay[] | null | undefined): ScheduleDay[] {
  return (schedules ?? []).filter((d) => {
    const abre = parseHHMM(d.openTime);
    const cierra = parseHHMM(d.closeTime);
    return abre !== null && cierra !== null && cierra > abre;
  });
}

/**
 * ¿Qué horario tiene ESTE día calendario según Ajustes?
 *
 * Devuelve `null` cuando la clínica no tiene horario utilizable (ni una fila
 * legible): el caller tiene que enseñar el número de citas y callarse el
 * porcentaje, no rellenar el hueco con un número de adorno.
 *
 * ⚠️ El día de la semana se saca con `scheduleDayOfISO`, que mide al MEDIODÍA
 * en la zona de la CLÍNICA. En Vercel el proceso corre en UTC: con `new Date()`
 * a secas, una clínica en Mexico_City vería el lunes de madrugada como domingo
 * y el Mes entero se correría un día.
 */
export function horarioDelDia(
  dayISO: string,
  schedules: ScheduleDay[] | null | undefined,
  timezone: string,
): HorarioDia | null {
  const utiles = filasUtiles(schedules);
  if (utiles.length === 0) return null;
  const dow = scheduleDayOfISO(dayISO, timezone); // 0=Lunes … 6=Domingo
  const fila = utiles.find((d) => d.dayOfWeek === dow);
  // Sin fila para ese día = ese día no está configurado = cerrado. Es la misma
  // lectura que hace `scheduleViolation` al avisar de una cita en día cerrado.
  if (!fila || !fila.enabled) return { abierto: false, aperturaMin: null, cierreMin: null };
  return {
    abierto: true,
    aperturaMin: parseHHMM(fila.openTime),
    cierreMin: parseHHMM(fila.closeTime),
  };
}

/** Minutos desde medianoche de un instante, vistos en la zona de la clínica. */
export function minutosEnTz(iso: string, timezone: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const p = getTzParts(new Date(ms), timezone);
  const hora = p.hour === 24 ? 0 : p.hour;
  return hora * 60 + p.minute;
}

/** Duración real de una cita en minutos. `null` si no se puede saber. */
function duracionMin(cita: CitaOcupacion): number | null {
  if (!cita.endsAt) return null;
  const ini = Date.parse(cita.startsAt);
  const fin = Date.parse(cita.endsAt);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return null;
  return (fin - ini) / 60_000;
}

export interface EntradaOcupacion {
  dayISO: string;
  /** Solo las citas de ESE día calendario, ya filtradas por el filtro activo. */
  citas: readonly CitaOcupacion[];
  schedules: ScheduleDay[] | null | undefined;
  timezone: string;
  /** Los carriles VISIBLES, en el mismo orden que las columnas de la vista Día. */
  carriles: readonly Carril[];
  /** Cómo se reparte una cita entre carriles: por responsable o por sillón. */
  modo?: "doctor" | "resource";
}

/**
 * La ocupación de un día: el número que va debajo de la barra del Mes y los
 * segmentos de colores que la forman.
 */
export function ocupacionDelDia(entrada: EntradaOcupacion): OcupacionDia {
  const { dayISO, citas, schedules, timezone, carriles } = entrada;
  const modo = entrada.modo ?? "doctor";

  const vivas = citas.filter((c) => c.status !== "CANCELLED");
  const totalCitas = vivas.length;
  const sinConfirmar = vivas.filter((c) => c.status === "SCHEDULED").length;

  const horario = horarioDelDia(dayISO, schedules, timezone);
  const horarioDesconocido = horario === null;
  const cerrado = horario !== null && !horario.abierto;

  const minutosAbiertos =
    horario && horario.abierto && horario.aperturaMin !== null && horario.cierreMin !== null
      ? horario.cierreMin - horario.aperturaMin
      : 0;
  const minutosDisponibles = minutosAbiertos * carriles.length;

  // Los minutos ocupados se reparten por carril. Una cita sin carril conocido
  // (doctor borrado, sillón sin asignar) suma al total del día pero no pinta
  // segmento: si le inventáramos un carril, la barra mentiría sobre QUIÉN.
  const porCarril = new Map<string, number>();
  let minutosOcupados = 0;
  for (const c of vivas) {
    if (c.status === "NO_SHOW") continue;
    const dur = duracionMin(c);
    if (dur === null) continue;
    minutosOcupados += dur;
    const clave = modo === "resource" ? c.resourceId : c.doctorId;
    if (!clave) continue;
    porCarril.set(clave, (porCarril.get(clave) ?? 0) + dur);
  }

  const puedeCalcular = minutosDisponibles > 0;
  const porcentaje = puedeCalcular
    ? Math.round((minutosOcupados / minutosDisponibles) * 100)
    : null;

  // Los segmentos se normalizan solo cuando el día está SOBREVENDIDO: así la
  // barra nunca se sale de su caja, pero un día al 60% sigue enseñando 60% de
  // barra pintada y 40% de hueco gris, que es lo que dice el diseño.
  const escala = puedeCalcular
    ? 1 / Math.max(minutosDisponibles, minutosOcupados)
    : 0;
  const segmentos: SegmentoOcupacion[] = carriles.map((carril) => {
    const minutos = porCarril.get(carril.id) ?? 0;
    return {
      carrilId: carril.id,
      nombre: carril.nombre,
      color: carril.color,
      minutos,
      fraccion: minutos * escala,
    };
  });

  return {
    dayISO,
    cerrado,
    horarioDesconocido,
    totalCitas,
    sinConfirmar,
    minutosOcupados,
    minutosDisponibles,
    porcentaje,
    segmentos,
  };
}

/**
 * La nota de una celda del Mes. El prototipo enseña tres: «2 sin confirmar»
 * (ámbar), «Cerrado» (gris) y «Feriado · Independencia» (gris).
 *
 * ⛔ La tercera NO se puede pintar con datos de verdad. En Dental no existe
 * modelo de días festivos ni de bloqueos de agenda: lo ÚNICO que sabe el
 * sistema es `ClinicSchedule` (`enabled` + horas por día de la semana). Los
 * otros verticales sí lo tienen —Barbería con `BarberTimeOff` (tipo `HOLIDAY`)
 * e Instituto con `EduAgendaBlock` (tipo `FESTIVO`)—, pero eso no es esta
 * agenda. Inventar «Feriado · Independencia» sería escribir en la pantalla del
 * dueño una cosa que el sistema no sabe: si ese 16 de septiembre la clínica
 * abrió, la agenda estaría mintiendo. Así que un día cerrado dice «Cerrado» y
 * punto, venga de donde venga el motivo.
 */
export type NotaDia =
  | { tipo: "cerrado"; texto: string }
  | { tipo: "sin-confirmar"; texto: string }
  | null;

export function notaDelDia(ocupacion: OcupacionDia): NotaDia {
  if (ocupacion.cerrado) return { tipo: "cerrado", texto: "Cerrado" };
  if (ocupacion.sinConfirmar > 0) {
    return {
      tipo: "sin-confirmar",
      texto: `${ocupacion.sinConfirmar} sin confirmar`,
    };
  }
  return null;
}

/**
 * Los carriles que hay que pintar de verdad: los visibles MÁS los
 * responsables que tienen citas en el rango pero no salen en la lista.
 *
 * No es una rareza teórica: la vista Día de siempre ya hace esta unión y
 * documenta por qué (`computeColumns` en agenda-page-client.tsx). Un doctor
 * dado de baja, o marcado como «no activo en agenda», conserva sus citas
 * futuras. Si la Semana solo pinta carriles de la lista de doctores activos,
 * esas citas **desaparecen de la pantalla** aunque el contador del día las
 * siga sumando — que es exactamente la causa raíz de «la agenda sale vacía
 * pero dice que hay 18 citas».
 *
 * Los huérfanos van SIEMPRE al final y en orden estable (el de aparición en la
 * lista de citas, que ya viene ordenada por hora), para que un carril no salte
 * de sitio entre dos renders.
 *
 * ⚠️ No confundir con el FILTRO. Si el usuario apagó a un doctor en el filtro,
 * sus citas no llegan aquí: se quitan antes, al filtrar las citas. Esto solo
 * rescata a quien nadie apagó y aun así no tiene columna.
 */
export function carrilesConHuerfanos(
  base: readonly Carril[],
  citas: readonly CitaOcupacion[],
  construir: (id: string) => Carril,
  modo: "doctor" | "resource" = "doctor",
): Carril[] {
  const conocidos = new Set(base.map((c) => c.id));
  const huerfanos: Carril[] = [];
  for (const cita of citas) {
    if (cita.status === "CANCELLED") continue;
    const id = modo === "resource" ? cita.resourceId : cita.doctorId;
    if (!id || conocidos.has(id)) continue;
    conocidos.add(id);
    huerfanos.push(construir(id));
  }
  return huerfanos.length === 0 ? [...base] : [...base, ...huerfanos];
}

/**
 * LA ARITMÉTICA DE FECHAS DE LOS BLOQUEOS — toda en la zona de la CLÍNICA.
 *
 * 🔴 La regla que hay detrás de cada función de este archivo: `inicio` y `fin`
 * de un bloqueo son INSTANTES ISO EN UTC, no horas de pared. Pintarlos con
 * `new Date(iso).getHours()` o con `toISOString().slice(0,10)` da el día y la
 * hora del PROCESO — que en Vercel es UTC — y a las 19:00 de México eso ya es
 * el día siguiente. Es el bug que se fotografió en /admin esta semana. Aquí no
 * hay ni un `getHours()`, ni un `toISOString().slice(0,10)`: todo pasa por
 * `getTzParts`, que es lo que ya usa la agenda.
 *
 * El intervalo es SEMIABIERTO `[inicio, fin)`, como en todo el repo: un
 * bloqueo de día completo «del 24 de diciembre al 2 de enero» se guarda con el
 * corte en las 00:00 del 3 de enero. Ver `calendarDayRangeUtc` en
 * `src/lib/agenda/time-utils.ts`, que ya lo resuelve así para la agenda.
 */

import { getTzParts } from "@/lib/agenda/time-utils";
import type { BloqueoDTO } from "./tipos";

export const MINUTOS_DEL_DIA = 24 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El día de calendario (`YYYY-MM-DD`) de un instante, en la zona de la clínica. */
export function diaDeInstante(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutos desde la medianoche de un instante, en la zona de la clínica. */
export function minutoDeInstante(iso: string, timezone: string): number {
  const p = getTzParts(new Date(iso), timezone);
  return p.hour * 60 + p.minute;
}

/**
 * `YYYY-MM-DD` + n días. Se arma en UTC **a mediodía**, que es la hora a la que
 * ninguna zona del mundo está cambiando de fecha: sumar días a medianoche se
 * salta o repite un día en los husos que cruzan el cambio de horario.
 */
export function sumarDias(dayISO: string, n: number): string {
  const [y, m, d] = dayISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ¿`a` es posterior a `b`? Comparación lexicográfica, exacta con `YYYY-MM-DD`. */
export function esPosterior(a: string, b: string): boolean {
  return a > b;
}

export function fechaValida(dayISO: string): boolean {
  if (!ES_FECHA.test(dayISO)) return false;
  const [y, m, d] = dayISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `HH:MM` → minutos del día, o `null` si no es una hora. */
export function deHora(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface RangoLocal {
  /** `YYYY-MM-DD` en la zona de la clínica. */
  desde: string;
  hasta: string;
  diaCompleto: boolean;
  /** `HH:MM`. Solo se miran si `diaCompleto` es false. */
  horaInicio: string;
  horaFin: string;
}

/** A quién cierra el bloqueo, resuelto desde quien está mirando la pantalla. */
export interface AlcanceBloqueo {
  /** true = quien mira no es admin: no elige a quién cierra. */
  modoDoctor: boolean;
  /** Su propio id de usuario, SOLO si es DOCTOR. Cualquier otro rol: `null`. */
  miDoctorId: string | null;
  /** Lo que el admin eligió en el selector. `""` = toda la clínica. */
  doctorElegido: string;
}

/**
 * EL CUERPO DEL POST, tal y como lo espera el servidor.
 *
 * 🔴 DÍAS Y HORAS TECLEADOS, NO INSTANTES UTC. Ver `cuerpoDeBloqueo`.
 */
export interface CuerpoBloqueo {
  /** `null` = toda la clínica. Va SIEMPRE, porque `null` significa algo. */
  doctorId: string | null;
  /** `YYYY-MM-DD`, tal como salió del campo. */
  desdeDia: string;
  /** `YYYY-MM-DD` INCLUSIVE: «hasta el 23» cubre el 23 entero. */
  hastaDia: string;
  /** `HH:MM`. Solo si NO es día completo; si no, no viaja la clave. */
  desdeHora?: string;
  hastaHora?: string;
}

/**
 * A QUIÉN CIERRA, en el valor que el servidor sabe resolver.
 *
 * 🔴 EL DOCTOR MANDA SU PROPIO ID, NO OMITE LA CLAVE. `resolverAlcance`
 * (service.ts) trata «sin doctorId» como «toda la clínica», y a un DOCTOR eso
 * le devuelve un 403 —«cerrar la clínica entera no es decisión de un
 * doctor»—: omitirla le impide crear hasta su propio bloqueo. Su bloqueo sale
 * a su nombre porque la pantalla lo dice, no porque el servidor lo adivine.
 *
 * Y esconder no es permitir: el servidor sigue comprobando que ese id es el
 * suyo. Esto es para que pueda crear el bloqueo que le corresponde, no para
 * sustituir la cerradura.
 */
export function alcanceDelBloqueo(a: AlcanceBloqueo): string | null {
  if (a.modoDoctor) return a.miDoctorId || null;
  return a.doctorElegido || null;
}

/**
 * LO QUE LA PERSONA TECLEÓ → EL CUERPO QUE VIAJA A LA API.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 AQUÍ NO SE CONVIERTE A UTC, Y NO ES UN DETALLE
 *
 * La conversión la hace el SERVIDOR con la zona de la CLÍNICA, que el
 * navegador no conoce (`parseRangoTecleado`, core.ts). Si la hiciera esta
 * pantalla, usaría la zona del DISPOSITIVO: un doctor que abre el panel desde
 * Cancún con el portátil en hora de Madrid cerraría la clínica con ocho horas
 * de desfase, y en un cierre de día entero ese desfase se come la primera
 * cita de la mañana.
 *
 * 🔴 «HASTA EL 23» INCLUYE EL 23 ENTERO. Aquí se manda el día tal cual; el
 * corte exclusivo en la medianoche del 24 lo pone el servidor.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Devuelve `null` si el rango no es utilizable; quien llama no manda nada.
 */
export function cuerpoDeBloqueo(rango: RangoLocal, alcance: AlcanceBloqueo): CuerpoBloqueo | null {
  const { desde, hasta, diaCompleto, horaInicio, horaFin } = rango;
  if (!fechaValida(desde)) return null;
  const doctorId = alcanceDelBloqueo(alcance);

  if (diaCompleto) {
    // Sin «Hasta», el bloqueo es de un día suelto: el mismo día en las dos claves.
    const fin = fechaValida(hasta) ? hasta : desde;
    if (esPosterior(desde, fin)) return null;
    return { doctorId, desdeDia: desde, hastaDia: fin };
  }

  // Por horas es de UN día: «el 12 de noviembre de 2 a 6». Un rango por horas
  // que cruzara varios días sería ambiguo (¿cuatro horas un día, o cuatro
  // horas cada día?) y no es ninguno de los dos casos del encargo.
  const ini = deHora(horaInicio);
  const fin = deHora(horaFin);
  if (ini === null || fin === null || fin <= ini) return null;
  return {
    doctorId,
    desdeDia: desde,
    hastaDia: desde,
    // Normalizadas a `HH:MM`: el campo tolera «9:00» y el servidor pide dos dígitos.
    desdeHora: comoHora(ini),
    hastaHora: comoHora(fin),
  };
}

/* ───────────────────── las franjas que se pintan en la rejilla ──────────── */

export interface BandaBloqueo {
  id: string;
  reason: string;
  /** `null` = cierra la clínica entera. Con id, cierra solo a ese doctor. */
  doctorId: string | null;
  doctorNombre: string | null;
  /** Minuto del día en que empieza EN ESTE día (0 si viene de antes). */
  desdeMin: number;
  /** Minuto del día en que acaba (1440 si sigue mañana). */
  hastaMin: number;
  /** Empezó antes de este día. */
  vieneDeAntes: boolean;
  /** Sigue DESPUÉS de este día — y no solo porque acabe en su medianoche. */
  sigueDespues: boolean;
  /** Tapa el día de punta a punta. */
  todoElDia: boolean;
}

/**
 * LOS BLOQUEOS QUE TAPAN ESTE DÍA, recortados a él y en minutos de pared.
 *
 * `doctorId` acota a una columna de responsable (vista Día). En `null` entran
 * todos los del día, que es lo que necesita una columna que ES un día (Semana)
 * o una celda del Mes.
 *
 * Descarta las bandas de duración cero: un bloqueo que acaba a las 00:00 de
 * este día NO tapa este día — el intervalo es semiabierto.
 */
export function bandasDelDia(
  bloqueos: readonly BloqueoDTO[],
  dayISO: string,
  timezone: string,
  doctorId: string | null = null,
): BandaBloqueo[] {
  const out: BandaBloqueo[] = [];
  for (const b of bloqueos) {
    // Un bloqueo de la clínica entera (doctorId null) alcanza a TODAS las
    // columnas; uno de un doctor, solo a la suya.
    if (doctorId !== null && b.doctorId !== null && b.doctorId !== doctorId) continue;

    const diaIni = diaDeInstante(b.inicio, timezone);
    const diaFin = diaDeInstante(b.fin, timezone);
    if (diaIni > dayISO || diaFin < dayISO) continue;

    const empiezaAntes = diaIni < dayISO;
    const acabaDespues = diaFin > dayISO;
    const desdeMin = empiezaAntes ? 0 : minutoDeInstante(b.inicio, timezone);
    const hastaMin = acabaDespues ? MINUTOS_DEL_DIA : minutoDeInstante(b.fin, timezone);
    if (hastaMin <= desdeMin) continue;

    // «Sigue mañana» NO es «acaba a medianoche». Un bloqueo «del 15 al 17» se
    // guarda con el corte en las 00:00 del 18: el 17 acaba en el borde y no
    // continúa. Sin esto, la franja del 17 prometería un 18 cerrado que la
    // rejilla enseña abierto.
    const finEnLaMedianocheSiguiente =
      minutoDeInstante(b.fin, timezone) === 0 && diaFin === sumarDias(dayISO, 1);

    out.push({
      id: b.id,
      reason: b.reason,
      doctorId: b.doctorId,
      doctorNombre: b.doctorNombre,
      desdeMin,
      hastaMin,
      vieneDeAntes: empiezaAntes,
      sigueDespues: acabaDespues && !finEnLaMedianocheSiguiente,
      todoElDia: desdeMin <= 0 && hastaMin >= MINUTOS_DEL_DIA,
    });
  }
  out.sort((a, b) => a.desdeMin - b.desdeMin || a.hastaMin - b.hastaMin);
  return out;
}

/* ──────────────────────────── texto para el ojo ─────────────────────────── */

/** `Intl` con la zona de la CLÍNICA puesta. Memoizado: crear uno cuesta. */
const cacheFmt = new Map<string, Intl.DateTimeFormat>();

function fmt(locale: string, timezone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const clave = `${locale}|${timezone}|${JSON.stringify(opts)}`;
  let f = cacheFmt.get(clave);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: timezone });
    cacheFmt.set(clave, f);
  }
  return f;
}

const localeDe = (locale: string) => (locale === "en" ? "en-US" : "es-MX");

/**
 * Un día de calendario (`YYYY-MM-DD`) como «24 de diciembre».
 *
 * Ojo con lo que NO hace: NO convierte de zona. Un `YYYY-MM-DD` ya es una
 * fecha de pared, y volver a pasarlo por la zona de la clínica la correría un
 * día. Se ancla a mediodía UTC y se formatea en UTC, que es la única manera de
 * que «2026-12-24» salga «24 de diciembre» en las 22 zonas de la lista.
 */
export function diaLargo(dayISO: string, locale: string): string {
  if (!fechaValida(dayISO)) return dayISO;
  const [y, m, d] = dayISO.split("-").map(Number);
  return fmt(localeDe(locale), "UTC", { day: "numeric", month: "long" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** «24 dic» — para los renglones estrechos de la lista y del aviso. */
export function diaCorto(dayISO: string, locale: string): string {
  if (!fechaValida(dayISO)) return dayISO;
  const [y, m, d] = dayISO.split("-").map(Number);
  return fmt(localeDe(locale), "UTC", { day: "numeric", month: "short" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** «Diciembre 2026» — el encabezado de cada grupo de la lista. */
export function mesLargo(dayISO: string, locale: string): string {
  if (!fechaValida(dayISO)) return dayISO;
  const [y, m, d] = dayISO.split("-").map(Number);
  const txt = fmt(localeDe(locale), "UTC", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** Minutos del día → `HH:MM`. */
export function comoHora(minutos: number): string {
  const m = ((Math.round(minutos) % MINUTOS_DEL_DIA) + MINUTOS_DEL_DIA) % MINUTOS_DEL_DIA;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** La hora de pared de un instante, en la zona de la clínica. */
export function horaDeInstante(iso: string, timezone: string): string {
  return comoHora(minutoDeInstante(iso, timezone));
}

/**
 * El día `YYYY-MM-DD` de un bloqueo, EN LA CLÍNICA, y el último día que ocupa.
 *
 * El último día es `fin` menos un minuto: con el corte exclusivo en las 00:00
 * del 3 de enero, el último día ocupado es el 2 y no el 3.
 */
export function diasDelBloqueo(b: BloqueoDTO, timezone: string): { primero: string; ultimo: string } {
  const primero = diaDeInstante(b.inicio, timezone);
  const finMs = new Date(b.fin).getTime();
  const ultimo = diaDeInstante(new Date(finMs - 60_000).toISOString(), timezone);
  return { primero, ultimo: ultimo < primero ? primero : ultimo };
}

/**
 * La fecha de una cita del 409. El servidor puede mandarla como instante ISO o
 * ya como `YYYY-MM-DD`; un `YYYY-MM-DD` es fecha de pared y NO se reconvierte.
 */
export function diaDeCita(fecha: string, timezone: string): string {
  if (ES_FECHA.test(fecha)) return fecha;
  const t = new Date(fecha);
  if (Number.isNaN(t.getTime())) return fecha;
  return diaDeInstante(fecha, timezone);
}

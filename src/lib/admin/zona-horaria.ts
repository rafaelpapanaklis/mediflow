/**
 * LA zona horaria del panel /admin, en un solo sitio.
 *
 * ── El fallo que arregla ────────────────────────────────────────────────────
 * `/admin` pintaba fechas con `toLocaleDateString("es-MX", {…})` SIN `timeZone`.
 * Sin zona, `Intl` usa la del runtime: en este servidor son ~2 h por delante de
 * Yucatán y en producción (Vercel, UTC) son 6. Medido el 20-sep-2026 a las
 * 19:52 de Mérida, la portada del panel decía «21 de septiembre».
 *
 * Y no es solo cosmético: los CORTES de «hoy», «este mes» y «este año» se
 * calculaban sobre el día del servidor, así que a partir de las 18:00 de Mérida
 * los ingresos del día ya se sumaban al día siguiente. Por eso los números no
 * cuadraban.
 *
 * Mismo criterio que `src/lib/consent/dates.ts`, que existe por un bug gemelo:
 * una carta de consentimiento se fechaba un día que todavía no había llegado.
 *
 * ── Por qué una constante y no `Clinic.timezone` ────────────────────────────
 * Esto NO es la zona de una clínica (esa vive en `Clinic.timezone` y la usa el
 * producto). Es la zona desde la que Rafael MIRA el panel: una sola, la misma
 * para las tres pantallas de /admin, pase lo que pase con las clínicas.
 *
 * PURO: sin Prisma, sin React y sin red. Se prueba con
 * `npm run test:zona-admin`.
 */

/**
 * Yucatán. UTC−6 todo el año: desde 2022 México no tiene horario de verano, así
 * que aquí no hay saltos. Aun así NADA en este archivo asume el −6 a mano — el
 * desfase se le pregunta a `Intl`, para que el día que cambie la regla el código
 * siga bien.
 */
export const ZONA_ADMIN = "America/Merida";

/** Idioma de las fechas del panel. */
export const LOCALE_ADMIN = "es-MX";

export type Fecha = Date | string | number | null | undefined;

function aFecha(valor: Fecha): Date | null {
  if (valor === null || valor === undefined) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Formato ────────────────────────────────────────────────────────────────

/** `15 sept 2026`. Sin fecha devuelve null: el llamador decide qué decir. */
export function fechaAdmin(valor: Fecha, opciones?: Intl.DateTimeFormatOptions): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return new Intl.DateTimeFormat(LOCALE_ADMIN, {
    timeZone: ZONA_ADMIN,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opciones,
  }).format(d);
}

/** `15 de septiembre de 2026`, para cuando hay sitio. */
export function fechaLargaAdmin(valor: Fecha): string | null {
  return fechaAdmin(valor, { day: "numeric", month: "long", year: "numeric" });
}

/** `15 sept 2026, 19:52`. */
export function fechaHoraAdmin(valor: Fecha): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return new Intl.DateTimeFormat(LOCALE_ADMIN, {
    timeZone: ZONA_ADMIN,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** `19:52`. */
export function horaAdmin(valor: Fecha): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return new Intl.DateTimeFormat(LOCALE_ADMIN, {
    timeZone: ZONA_ADMIN,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// ── Cortes de periodo: lo que de verdad descuadraba las métricas ───────────

interface PartesLocales {
  anio: number; mes: number; dia: number;
  hora: number; minuto: number; segundo: number;
}

/** Qué hora marca el reloj de Mérida en este instante. */
function partesEnZona(instante: Date): PartesLocales {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_ADMIN,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante);

  const m: Record<string, string> = {};
  for (const p of partes) if (p.type !== "literal") m[p.type] = p.value;

  return {
    anio: Number(m.year),
    mes: Number(m.month),
    dia: Number(m.day),
    // `hour12:false` da "24" para la medianoche en algunos runtimes.
    hora: Number(m.hour) % 24,
    minuto: Number(m.minute),
    segundo: Number(m.second),
  };
}

/** Desfase de la zona respecto a UTC, en minutos, EN ese instante. */
function desfaseMinutos(instante: Date): number {
  const p = partesEnZona(instante);
  const comoSiFueraUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // Se tira el resto de milisegundos: formatToParts no los da.
  const base = Math.floor(instante.getTime() / 1000) * 1000;
  return (comoSiFueraUtc - base) / 60_000;
}

/**
 * El instante UTC en el que el reloj de Mérida marca esa fecha y hora.
 *
 * Dos pasadas: la primera estima el desfase, la segunda lo corrige. Con una
 * zona de desfase fijo la primera ya acierta; la segunda está para que esto
 * siga siendo correcto si algún día la zona vuelve a tener horario de verano.
 */
function instanteDeLocal(anio: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0): Date {
  const ingenuo = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo);
  let resultado = new Date(ingenuo - desfaseMinutos(new Date(ingenuo)) * 60_000);
  resultado = new Date(ingenuo - desfaseMinutos(resultado) * 60_000);
  return resultado;
}

/** El día de Mérida como `YYYY-MM-DD`. La clave con la que agrupar por día. */
export function diaAdmin(ahora: Date = new Date()): string {
  const p = partesEnZona(ahora);
  const dd = String(p.dia).padStart(2, "0");
  const mm = String(p.mes).padStart(2, "0");
  return `${p.anio}-${mm}-${dd}`;
}

/** Medianoche de HOY en Mérida. El corte de «ingresos de hoy». */
export function inicioDeHoy(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeLocal(p.anio, p.mes, p.dia);
}

/** Medianoche de mañana en Mérida: el fin abierto de «hoy» (`lt`). */
export function finDeHoy(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeLocal(p.anio, p.mes, p.dia + 1);
}

/** Día 1 del mes en curso en Mérida, a las 00:00. */
export function inicioDeMes(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeLocal(p.anio, p.mes, 1);
}

/** 1 de enero del año en curso en Mérida, a las 00:00. */
export function inicioDeAnio(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeLocal(p.anio, 1, 1);
}

/** Medianoche de hace `dias` días en Mérida (ventanas de actividad). */
export function inicioDeHaceDias(dias: number, ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeLocal(p.anio, p.mes, p.dia - dias);
}

/**
 * Los tres cortes de la portada, de una vez. `hoy`, `mes` y `anio` son
 * instantes UTC listos para un `where: { gte: … }` de Prisma.
 */
export interface CortesAdmin {
  ahora: Date;
  hoy: Date;
  finHoy: Date;
  mes: Date;
  anio: Date;
}

export function cortesAdmin(ahora: Date = new Date()): CortesAdmin {
  return {
    ahora,
    hoy:    inicioDeHoy(ahora),
    finHoy: finDeHoy(ahora),
    mes:    inicioDeMes(ahora),
    anio:   inicioDeAnio(ahora),
  };
}

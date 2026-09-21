/**
 * LA hora del panel /admin, en un solo sitio: el FORMATO y los CORTES de
 * periodo. De aquí lo toman las tres pantallas (portada, clínicas y clientes).
 *
 * ── El fallo que arregla ────────────────────────────────────────────────────
 * `/admin` pintaba fechas con `toLocaleDateString("es-MX", {…})` SIN `timeZone`,
 * así que fechaba en la zona del runtime. Medido el 20-sep-2026: en Mérida eran
 * las 19:52 del día 20, el servidor del panel marcaba las 21:52, y el de
 * producción (que corre en UTC) ya decía **21 de septiembre**. Rafael lo vio
 * como «dice que ya es 21 y aquí son las 7:47pm del 20».
 *
 * Y no era solo el texto: los CORTES de «hoy», «este mes» y «este año» salían
 * de `new Date(y, m, 1)`, que también usa la zona del runtime. A partir de las
 * 18:00 de Mérida, lo cobrado hoy se sumaba a mañana, y lo del último día del
 * mes, al mes siguiente. Ése es el descuadre de las métricas.
 *
 * Mismo criterio que `src/lib/consent/dates.ts`, que existe por un bug gemelo:
 * una carta de consentimiento se fechaba un día que todavía no había llegado.
 *
 * ── Por qué una constante y no `Clinic.timezone` ni `DEFAULT_TZ` ────────────
 * `DEFAULT_TZ` (`src/lib/agenda/date-ranges.ts`) es `America/Mexico_City` y es
 * la zona de la CLÍNICA: cada clínica agenda en la suya, y la suya vive en
 * `Clinic.timezone`. Esto es otra cosa — es la zona de la PERSONA que opera el
 * panel, que está en Mérida. Hoy coinciden en número; se declaran aparte porque
 * son dos decisiones distintas y algún día pueden divergir.
 *
 * PURO: sin Prisma, sin React y sin red. Se prueba con `npm run test:zona-admin`.
 */

/**
 * Yucatán. UTC−6 todo el año: desde 2022 México no tiene horario de verano, así
 * que aquí no hay saltos. Aun así NADA en este archivo asume el −6 a mano — el
 * desfase se le pregunta a `Intl`, para que el día que cambie la regla el código
 * siga bien.
 *
 * Es el ÚNICO nombre de esta zona. Hubo un tiempo en que también se llamaba
 * `ADMIN_TZ` desde la portada; dos nombres para la misma constante son la
 * semilla de que los dos archivos vuelvan a divergir.
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

/**
 * Los formateadores de `Intl` son caros de construir y aquí se llaman por fila
 * de tabla. Se cachean por forma en el módulo. `fechaAdmin` con opciones a
 * medida no entra al caché: esa forma es de un solo uso.
 */
const FORMATEADORES = new Map<string, Intl.DateTimeFormat>();

function formateador(clave: string, opciones: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheado = FORMATEADORES.get(clave);
  if (cacheado) return cacheado;
  const creado = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, ...opciones });
  FORMATEADORES.set(clave, creado);
  return creado;
}

const CORTA: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/** `20 sept 2026`. Sin fecha devuelve null: el llamador decide qué decir. */
export function fechaAdmin(valor: Fecha, opciones?: Intl.DateTimeFormatOptions): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  if (!opciones) return formateador("corta", CORTA).format(d);
  return new Intl.DateTimeFormat(LOCALE_ADMIN, {
    timeZone: ZONA_ADMIN,
    ...CORTA,
    ...opciones,
  }).format(d);
}

/** `20 de septiembre de 2026`, para cuando hay sitio. */
export function fechaLargaAdmin(valor: Fecha): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return formateador("larga", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

/**
 * `domingo, 20 de septiembre de 2026` — el encabezado de la portada, que sí
 * quiere el día de la semana. Sale en minúsculas a propósito: la mayúscula la
 * pone la UI con `::first-letter`.
 */
export function fechaConDiaSemanaAdmin(valor: Fecha): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return formateador("con-dia-semana", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** `20 sept 2026, 19:52`. Para «visto hace un momento» y auditorías. */
export function fechaHoraAdmin(valor: Fecha): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return formateador("fecha-hora", {
    ...CORTA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** `19:52`. */
export function horaAdmin(valor: Fecha): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  return formateador("hora", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

// ── El reloj de pared de Mérida ────────────────────────────────────────────

interface PartesEnZona {
  anio: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_ADMIN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Qué marca el reloj de pared de Mérida en el instante `d`. */
function partesEnZona(d: Date): PartesEnZona {
  const p = PARTES.formatToParts(d);
  const n = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const parte = p.find((x) => x.type === tipo);
    return parte ? parseInt(parte.value, 10) : 0;
  };
  return {
    anio: n("year"),
    mes: n("month"),
    dia: n("day"),
    // Algunas versiones de ICU devuelven "24" para la medianoche con
    // hour12:false. `% 24` lo normaliza a 0 y evita un desfase de un día.
    hora: n("hour") % 24,
    minuto: n("minute"),
    segundo: n("second"),
  };
}

/**
 * Cuánto va la hora de pared de Mérida por delante de UTC en el instante `d`,
 * en milisegundos (negativo, porque es UTC−6).
 */
function desfaseEnZona(d: Date): number {
  const p = partesEnZona(d);
  const comoSiFueraUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // El desfase se redondea al segundo porque `Date.UTC` no lleva los ms del
  // instante original; da igual, solo se usa para situar un corte de día.
  return comoSiFueraUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * El instante UTC en el que empieza un día concreto de Mérida. `mes` y `dia`
 * pueden salirse de rango (`dia - 30`, `mes + 1`): `Date.UTC` los normaliza,
 * que es justo lo que quieren `inicioDeHaceDias` y `finDelDia`.
 *
 * Dos pasadas a propósito: la primera estima el desfase con el instante que nos
 * dan, la segunda lo recalcula ya sobre la medianoche candidata. Con una zona
 * de offset fijo como Mérida la segunda pasada nunca cambia nada; se hace igual
 * para que la función siga siendo correcta si algún día la zona del panel se
 * cambia por una que sí tenga horario de verano.
 */
function instanteDeMedianoche(anio: number, mes: number, dia: number, referencia: Date): Date {
  const paredUtc = Date.UTC(anio, mes - 1, dia, 0, 0, 0);
  const primera = new Date(paredUtc - desfaseEnZona(referencia));
  return new Date(paredUtc - desfaseEnZona(primera));
}

// ── Cortes de periodo: lo que de verdad descuadraba las métricas ───────────

/** El día de Mérida como `YYYY-MM-DD`. La clave con la que agrupar por día. */
export function diaAdmin(ahora: Date = new Date()): string {
  const p = partesEnZona(ahora);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Medianoche del día de Mérida que contiene a `ahora`. El corte de «hoy». */
export function inicioDelDia(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeMedianoche(p.anio, p.mes, p.dia, ahora);
}

/** Medianoche del día siguiente en Mérida: el fin abierto de «hoy» (`lt`). */
export function finDelDia(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeMedianoche(p.anio, p.mes, p.dia + 1, ahora);
}

/** Día 1 del mes en curso en Mérida, a las 00:00. */
export function inicioDelMes(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeMedianoche(p.anio, p.mes, 1, ahora);
}

/** Día 1 del mes ANTERIOR al de `ahora`, en Mérida. */
export function inicioDelMesAnterior(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  const mes = p.mes === 1 ? 12 : p.mes - 1;
  const anio = p.mes === 1 ? p.anio - 1 : p.anio;
  return instanteDeMedianoche(anio, mes, 1, ahora);
}

/** 1 de enero del año en curso en Mérida, a las 00:00. */
export function inicioDelAnio(ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeMedianoche(p.anio, 1, 1, ahora);
}

/** Medianoche de hace `dias` días en Mérida (ventanas de actividad). */
export function inicioDeHaceDias(dias: number, ahora: Date = new Date()): Date {
  const p = partesEnZona(ahora);
  return instanteDeMedianoche(p.anio, p.mes, p.dia - dias, ahora);
}

/**
 * Días enteros de Mérida entre dos instantes: `hasta − desde`. Cuenta CAMBIOS
 * DE FECHA, no tramos de 24 h, que es lo que espera quien lee «hace 1 día»
 * mirando una cita de ayer por la tarde.
 */
export function diasDeCalendario(desde: Date, hasta: Date): number {
  const a = inicioDelDia(desde).getTime();
  const b = inicioDelDia(hasta).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Los cortes de la portada, de una vez. Todos son instantes UTC listos para un
 * `where: { gte: … }` de Prisma.
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
    hoy:    inicioDelDia(ahora),
    finHoy: finDelDia(ahora),
    mes:    inicioDelMes(ahora),
    anio:   inicioDelAnio(ahora),
  };
}

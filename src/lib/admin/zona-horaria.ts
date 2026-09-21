// ─────────────────────────────────────────────────────────────────────────────
// La hora del panel /admin. UN solo sitio, y de aquí lo toman las tres
// pantallas (portada, clínicas y clientes).
//
// ── EL FALLO QUE ARREGLA ────────────────────────────────────────────────────
// `/admin` llamaba a `toLocaleDateString("es-MX", …)` SIN `timeZone`, así que
// fechaba en la zona del runtime. Medido el 20-sep-2026: en Mérida eran las
// 19:52 del día 20, el servidor de este panel marcaba las 21:52 del 20, y el
// de producción (que corre en UTC) ya decía **21 de septiembre**. Rafael lo vio
// como «dice que ya es 21 y aquí son las 7:47pm del 20».
//
// Y no era solo el texto: los CORTES de periodo salían de `new Date(y, m, 1)`,
// que también usa la zona del runtime. A partir de las 18:00 de Mérida, lo
// cobrado «hoy» empezaba a sumarse a mañana y lo del último día del mes, al mes
// siguiente. Ése es el descuadre de las métricas.
//
// Mismo criterio que `src/lib/consent/dates.ts`, que existe por la misma razón:
// una carta de consentimiento llegó a fechar un día que aún no había llegado.
//
// ── POR QUÉ `America/Merida` Y NO EL DEFAULT DEL PRODUCTO ───────────────────
// `DEFAULT_TZ` (src/lib/agenda/date-ranges.ts) es `America/Mexico_City` y es la
// zona de la CLÍNICA: cada clínica agenda en la suya. Esto es otra cosa — es la
// zona de la PERSONA que opera el panel, que está en Mérida. Yucatán está en
// UTC−6 todo el año (no aplica horario de verano desde 2022), así que hoy
// coincide en número con Ciudad de México; se declara aparte porque son dos
// decisiones distintas y algún día pueden divergir.
//
// PURO: sin Prisma, sin React, sin red. Probado en `zona-horaria.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/** Zona horaria desde la que se opera el panel /admin. */
export const ADMIN_TZ = "America/Merida";

interface PartesFecha {
  anio: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

/**
 * Los formateadores de `Intl` son caros de construir y aquí se llaman por fila.
 * Se cachean por clave (zona + forma) en el módulo, igual que hace crm-ui.
 */
const FORMATEADORES = new Map<string, Intl.DateTimeFormat>();

function formateador(clave: string, opciones: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheado = FORMATEADORES.get(clave);
  if (cacheado) return cacheado;
  const creado = new Intl.DateTimeFormat("es-MX", { timeZone: ADMIN_TZ, ...opciones });
  FORMATEADORES.set(clave, creado);
  return creado;
}

const PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: ADMIN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Qué marca el reloj de pared de Mérida en el instante `d`. */
function partesEnAdmin(d: Date): PartesFecha {
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
function desfaseEnAdmin(d: Date): number {
  const p = partesEnAdmin(d);
  const comoSiFueraUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // El desfase se redondea al segundo porque `Date.UTC` no lleva los ms del
  // instante original; da igual, solo se usa para situar un corte de día.
  return comoSiFueraUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * El instante UTC en el que empieza un día concreto de Mérida.
 *
 * Dos pasadas a propósito: la primera estima el desfase con el instante que nos
 * dan, la segunda lo recalcula ya sobre la medianoche candidata. Con una zona
 * de offset fijo como Mérida la segunda pasada nunca cambia nada; se hace igual
 * para que la función siga siendo correcta si algún día la zona del panel se
 * cambia por una que sí tenga horario de verano.
 */
function instanteDeMedianoche(anio: number, mes: number, dia: number, referencia: Date): Date {
  const paredUtc = Date.UTC(anio, mes - 1, dia, 0, 0, 0);
  const primera = new Date(paredUtc - desfaseEnAdmin(referencia));
  const segunda = new Date(paredUtc - desfaseEnAdmin(primera));
  return segunda;
}

/** Comienzo del día de Mérida que contiene a `now`. */
export function inicioDelDia(now: Date): Date {
  const p = partesEnAdmin(now);
  return instanteDeMedianoche(p.anio, p.mes, p.dia, now);
}

/** Comienzo del mes de Mérida que contiene a `now`. */
export function inicioDelMes(now: Date): Date {
  const p = partesEnAdmin(now);
  return instanteDeMedianoche(p.anio, p.mes, 1, now);
}

/** Comienzo del mes ANTERIOR al de `now`, en Mérida. */
export function inicioDelMesAnterior(now: Date): Date {
  const p = partesEnAdmin(now);
  const mes = p.mes === 1 ? 12 : p.mes - 1;
  const anio = p.mes === 1 ? p.anio - 1 : p.anio;
  return instanteDeMedianoche(anio, mes, 1, now);
}

/** Comienzo del año de Mérida que contiene a `now`. */
export function inicioDelAnio(now: Date): Date {
  const p = partesEnAdmin(now);
  return instanteDeMedianoche(p.anio, 1, 1, now);
}

/** «YYYY-MM-DD» del día de Mérida. Sirve de clave para agrupar por día. */
export function diaAdmin(d: Date): string {
  const p = partesEnAdmin(d);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** «domingo, 20 de septiembre de 2026» — el encabezado de la portada. */
export function fechaLargaAdmin(d: Date): string {
  return formateador("larga", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** «20 sept 2026». */
export function fechaCortaAdmin(d: Date): string {
  return formateador("corta", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** «20 sept 2026, 19:52». Para «visto hace un momento» y auditorías. */
export function fechaHoraAdmin(d: Date): string {
  return formateador("fechahora", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** «19:52». */
export function horaAdmin(d: Date): string {
  return formateador("hora", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/**
 * Días enteros de Mérida entre dos instantes: `hoy − aquel día`. Cuenta CAMBIOS
 * DE FECHA, no tramos de 24 h, que es lo que espera quien lee «hace 1 día»
 * mirando una cita de ayer por la tarde.
 */
export function diasDeCalendario(desde: Date, hasta: Date): number {
  const a = inicioDelDia(desde).getTime();
  const b = inicioDelDia(hasta).getTime();
  return Math.round((b - a) / 86_400_000);
}

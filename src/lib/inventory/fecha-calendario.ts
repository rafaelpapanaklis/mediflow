// Fechas de CALENDARIO de Inventario (ws1-t5): la caducidad de un lote y el
// «hoy» de la clínica. Reglas puras, sin Prisma y sin fecha del sistema (el
// `now` se inyecta). Lo prueba __tests__/fecha-calendario.test.ts.
//
// Una caducidad es un DÍA («caduca el 1 de septiembre»), no un instante: no
// tiene hora ni zona. Guardada en un `DateTime` necesita una convención, y
// había dos conviviendo:
//
//   · el alta de lote hacía `new Date("2026-09-01")`      → 2026-09-01T00:00Z
//   · la compra hacía `new Date("2026-09-01T00:00-06:00")` → 2026-09-01T06:00Z
//
// y la pantalla las pintaba con la zona del NAVEGADOR: la primera, vista
// desde México (UTC−6), caía en la tarde del 31 de agosto — «caduca 31 ago».
//
// La convención desde aquí: medianoche UTC del día de calendario, y se lee
// SIEMPRE por sus partes UTC. Las dos formas ya guardadas dan el día correcto
// leídas así (00:00Z y 06:00Z son el mismo día UTC), de modo que no hay que
// migrar ni una fila.

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})/;

/** La zona por defecto del panel (la misma del `@default` de `Clinic.timezone`). */
export const ZONA_POR_DEFECTO = "America/Mexico_City";

function dosDigitos(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Lo que manda el formulario («2026-09-01», o un ISO completo de un cliente
 * viejo) → el `Date` que se guarda: medianoche UTC de ESE día de calendario.
 * De un ISO con hora se toma el día que trae escrito, sin convertir zonas.
 * `null` si no es una fecha real (texto suelto, 31 de febrero…).
 */
export function parseFechaCalendario(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = SOLO_FECHA.exec(raw.trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // `Date.UTC` desborda en silencio (31-feb → 3-mar): si no vuelve el mismo
  // día que entró, la fecha no existía.
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d;
}

/**
 * Lo guardado (o su ISO, que es lo que viaja al navegador) → «2026-09-01».
 * Lee las partes UTC, así que acierta con las dos formas ya guardadas.
 */
export function fechaCalendarioDe(valor: Date | string | null | undefined): string | null {
  if (valor == null) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${dosDigitos(d.getUTCMonth() + 1)}-${dosDigitos(d.getUTCDate())}`;
}

/** Lo guardado → «01 sep 2026», el mismo día en cualquier navegador. */
export function formatearFechaCalendario(valor: Date | string | null | undefined): string {
  if (valor == null) return "—";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * El día de HOY en la zona de la clínica, «2026-09-27». Para el valor inicial
 * de un campo de fecha: `new Date().toISOString().slice(0, 10)` es el día en
 * UTC, y a partir de las 18:00 de México ya es mañana.
 * Una zona vacía o que el motor no conoce cae en la zona por defecto.
 */
export function hoyEnZona(timezone: string | null | undefined, now: Date = new Date()): string {
  const partes = (zona: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now);
  let lista: Intl.DateTimeFormatPart[];
  try {
    lista = partes(timezone && timezone.trim() ? timezone.trim() : ZONA_POR_DEFECTO);
  } catch {
    lista = partes(ZONA_POR_DEFECTO);
  }
  const de = (tipo: string) => lista.find((p) => p.type === tipo)?.value ?? "";
  return `${de("year")}-${de("month")}-${de("day")}`;
}

// ── La fecha de una COMPRA ───────────────────────────────────────────────
//
// No es lo mismo que una caducidad, aunque el arreglo se parezca. La fecha de
// la compra es también la fecha de su GASTO («Insumos»), y Gastos guarda y
// consulta instantes: «el gasto del 1 de octubre» es la medianoche del 1 de
// octubre EN LA CLÍNICA. Guardada a medianoche UTC, una compra del 1 de
// octubre caería a las 18:00 del 30 de septiembre y se iría al mes anterior.
//
// Por eso la compra se guarda como el INICIO DE ESE DÍA EN LA ZONA DE LA
// CLÍNICA, y se pinta en esa misma zona. Antes la hora de México iba escrita
// fija (`-06:00`) al guardar y se pintaba con la zona del NAVEGADOR: en una
// clínica de Tijuana, o vista desde otro huso, salía un día antes.

function zonaValida(timezone: string | null | undefined): string {
  const z = timezone && timezone.trim() ? timezone.trim() : ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: z });
    return z;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

/** Las partes de reloj (año…minuto) de un instante visto desde una zona. */
function relojEnZona(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante);
  const de = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return Date.UTC(de("year"), de("month") - 1, de("day"), de("hour"), de("minute"), de("second"));
}

/**
 * El instante en que EMPIEZA un día de calendario («2026-10-01») en la zona
 * de la clínica. Con horario de verano incluido (Tijuana lo tiene): el
 * desfase se mide en ese día concreto, no se da por sabido.
 */
export function inicioDelDiaEnZona(dia: unknown, timezone: string | null | undefined): Date | null {
  const medianocheUtc = parseFechaCalendario(dia);
  if (!medianocheUtc) return null;
  const zona = zonaValida(timezone);
  // Se parte de la medianoche UTC y se corrige por lo que la zona «ve» de
  // más o de menos. Dos pasadas: la primera puede caer al otro lado de un
  // cambio de horario.
  let instante = medianocheUtc;
  for (let i = 0; i < 2; i++) {
    const desfase = relojEnZona(instante, zona) - instante.getTime();
    instante = new Date(medianocheUtc.getTime() - desfase);
  }
  return instante;
}

const SOLO_FECHA_EXACTA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lo que manda «Registrar compra» → el instante que se guarda.
 *   · sin fecha           → ahora mismo
 *   · «2026-10-01»        → el inicio de ese día en la zona de la clínica
 *   · un ISO con su hora  → ese instante, tal cual
 *   · cualquier otra cosa → `null` (fecha inválida)
 */
export function parseFechaDeCompra(
  raw: unknown,
  timezone: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (raw === undefined || raw === null || raw === "") return now;
  if (typeof raw !== "string") return null;
  const texto = raw.trim();
  if (texto === "") return now;
  if (SOLO_FECHA_EXACTA.test(texto)) return inicioDelDiaEnZona(texto, timezone);
  const d = new Date(texto);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Lo guardado → el día de la compra, «2026-10-01», visto desde la clínica.
 *
 * Tolera la forma que ya hay guardada: las compras anteriores a este arreglo
 * llevan la hora de México escrita fija, así que caen EXACTAMENTE a las
 * 06:00:00.000Z. Esas se leen por su día UTC, que es el que se tecleó; una
 * compra nueva de una clínica a UTC−6 cae a esa misma hora y da lo mismo.
 */
export function diaDeCompra(valor: Date | string | null | undefined, timezone: string | null | undefined): string | null {
  if (valor == null) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  const esFormaAnterior =
    d.getUTCHours() === 6 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (esFormaAnterior) return fechaCalendarioDe(d);
  return hoyEnZona(zonaValida(timezone), d);
}

/** Lo guardado → «01 oct 2026», el día de la compra en la clínica. */
export function formatearFechaDeCompra(valor: Date | string | null | undefined, timezone: string | null | undefined): string {
  const dia = diaDeCompra(valor, timezone);
  return dia ? formatearFechaCalendario(parseFechaCalendario(dia)) : "—";
}

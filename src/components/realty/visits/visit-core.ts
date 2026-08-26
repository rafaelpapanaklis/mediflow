// ═══════════════════════════════════════════════════════════════════════
// NÚCLEO PURO de la agenda de visitas y del control de llaves.
//
// Sin Prisma, sin "server-only", sin JSX: lo importan LOS DOS lados —
// `src/lib/realty/visits.ts` (servidor) y los componentes de esta carpeta
// (navegador). Esa simetría es el punto: la misma función que coloca una
// tarjeta en la rejilla mientras la arrastras es la que el servidor usa
// para decidir en qué día cae al guardarla.
//
// ⚠️ POR QUÉ VIVE BAJO components/ Y NO EN lib/realty/: la allowlist de esta
// terminal solo abre `src/lib/realty/visits.ts` y `src/lib/realty/keys.ts`,
// y esos dos importan Prisma. Un módulo que importa Prisma NO lo puede
// tocar un componente de cliente sin tumbar el build (es el bug de
// "server-only arrastrado por un client" que el repo ya pagó). La
// convención del vertical para eso es un `*-shared.ts` —
// `src/lib/realty/properties-shared.ts` es el precedente— pero ese archivo
// está fuera de la allowlist. Así que el módulo puro vive aquí, que sí es
// territorio de esta terminal, y el servidor lo importa. Si algún día se
// abre `visits-shared.ts`, esto se mueve tal cual y se cambia UN import.
//
// FECHAS — la regla que hace que nada se corrompa:
// Las columnas son TIMESTAMP(3) SIN zona. La zona es un dato de NEGOCIO
// (RealtyAccount.timezone), nunca la del servidor ni la del navegador. Por
// eso aquí no hay un solo getHours() / getDate() / new Date(y, m, d): todo
// pasa por Intl con `timeZone` explícito. En Vercel el proceso corre en UTC
// y una visita de las 11:00 en Guadalajara se anunciaba a las 17:00.
// ═══════════════════════════════════════════════════════════════════════

// ── 1. Contrato de la pantalla ──────────────────────────────────────────

export type RealtyVisitStatusKey =
  | "PROGRAMADA"
  | "CONFIRMADA"
  | "REALIZADA"
  | "CANCELADA"
  | "NO_ASISTIO";

/**
 * Estados desde los que TODAVÍA se puede mover una visita en el calendario.
 * Arrastrar una cancelada o una que ya pasó por "realizada" no reagenda
 * nada: crea confusión sobre qué ocurrió de verdad.
 */
export const REALTY_VISIT_MOVABLE: RealtyVisitStatusKey[] = ["PROGRAMADA", "CONFIRMADA"];

export function isVisitMovable(status: RealtyVisitStatusKey): boolean {
  return REALTY_VISIT_MOVABLE.indexOf(status) !== -1;
}

/**
 * Transiciones permitidas. No es decoración: evita que un clic accidental
 * "resucite" una visita cancelada o marque como realizada una del futuro
 * sin pasar por la pantalla de retroalimentación.
 *
 * REALIZADA y NO_ASISTIO son terminales EN LA UI (se corrigen volviendo a
 * PROGRAMADA a propósito, que es un acto explícito y queda en la bitácora).
 */
const VISIT_FLOW: Record<RealtyVisitStatusKey, RealtyVisitStatusKey[]> = {
  PROGRAMADA: ["CONFIRMADA", "REALIZADA", "NO_ASISTIO", "CANCELADA"],
  CONFIRMADA: ["PROGRAMADA", "REALIZADA", "NO_ASISTIO", "CANCELADA"],
  REALIZADA: ["PROGRAMADA"],
  NO_ASISTIO: ["PROGRAMADA"],
  CANCELADA: ["PROGRAMADA"],
};

export function canVisitTransition(
  from: RealtyVisitStatusKey,
  to: RealtyVisitStatusKey,
): boolean {
  if (from === to) return true;
  const allowed = VISIT_FLOW[from];
  return Array.isArray(allowed) && allowed.indexOf(to) !== -1;
}

/** Lo que la rejilla necesita de una visita. Fechas SIEMPRE como ISO. */
export interface RealtyVisitCardDTO {
  id: string;
  propertyId: string;
  propertyTitle: string;
  /** Para la ruta del día y la liga a mapas. */
  propertyAddress: string | null;
  propertyColonia: string | null;
  propertyCity: string | null;
  lat: number | null;
  lng: number | null;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  userId: string | null;
  userName: string | null;
  /** ISO 8601 en UTC. La hora de pared se calcula con la zona de la cuenta. */
  scheduledAt: string;
  status: RealtyVisitStatusKey;
  outcome: RealtyVisitOutcome | null;
  note: string | null;
}

/** Una llave prestada. `returnedAt` null = sigue fuera. */
export interface RealtyKeyCardDTO {
  id: string;
  propertyId: string;
  propertyTitle: string;
  holderUserId: string | null;
  holderName: string | null;
  holderNote: string | null;
  takenAt: string;
  returnedAt: string | null;
  /** Días completos fuera. Se calcula en el servidor para no depender del reloj del navegador. */
  daysOut: number;
  overdue: boolean;
}

export interface RealtyVisitAgentDTO {
  id: string;
  name: string;
}

// ── 2. Zona horaria ─────────────────────────────────────────────────────

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface RealtyParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo, criterio de getDay(). */
  weekday: number;
}

/** Descompone un instante EN LA ZONA DE LA CUENTA. */
export function realtyParts(date: Date, timeZone: string): RealtyParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = new Map<string, string>();
  const parts = fmt.formatToParts(date);
  for (let i = 0; i < parts.length; i++) map.set(parts[i].type, parts[i].value);
  // Intl devuelve "24" para la medianoche con hourCycle h23/h24.
  const rawHour = parseInt(map.get("hour") ?? "0", 10);
  return {
    year: parseInt(map.get("year") ?? "1970", 10),
    month: parseInt(map.get("month") ?? "1", 10),
    day: parseInt(map.get("day") ?? "1", 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(map.get("minute") ?? "0", 10),
    weekday: WEEKDAY_INDEX[map.get("weekday") ?? "Sun"] ?? 0,
  };
}

/** "2026-08-25" del instante, en la zona de la cuenta. */
export function realtyDateISO(date: Date, timeZone: string): string {
  const p = realtyParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Minutos desde la medianoche local de la cuenta. */
export function realtyMinuteOfDay(date: Date, timeZone: string): number {
  const p = realtyParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * (fecha local + minuto del día) → instante UTC. EL helper crítico.
 *
 * Converge en dos pasadas incluso cruzando un cambio de horario: la primera
 * corrige el offset nominal, la segunda el salto del propio cambio. México
 * quitó el horario de verano en 2022, pero los municipios de la frontera
 * norte siguen el calendario de Estados Unidos — la segunda pasada no es
 * teoría, es Tijuana.
 */
export function realtyLocalToUtc(dateISO: string, minuteOfDay: number, timeZone: string): Date {
  const bits = dateISO.split("-");
  const y = parseInt(bits[0], 10);
  const m = parseInt(bits[1], 10);
  const d = parseInt(bits[2], 10);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desired = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  let guess = desired;
  for (let i = 0; i < 2; i++) {
    const p = realtyParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    const drift = seen - desired;
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

/** "2026-08-25" + n días → "2026-08-28". Aritmética pura de calendario. */
export function addDaysISO(dateISO: string, days: number): string {
  const bits = dateISO.split("-");
  const dt = new Date(
    Date.UTC(parseInt(bits[0], 10), parseInt(bits[1], 10) - 1, parseInt(bits[2], 10)),
  );
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function weekdayOfISO(dateISO: string): number {
  const bits = dateISO.split("-");
  return new Date(
    Date.UTC(parseInt(bits[0], 10), parseInt(bits[1], 10) - 1, parseInt(bits[2], 10)),
  ).getUTCDay();
}

/** Lunes de la semana que contiene a dateISO. La semana laboral empieza el lunes. */
export function startOfWeekISO(dateISO: string): string {
  const wd = weekdayOfISO(dateISO);
  return addDaysISO(dateISO, wd === 0 ? -6 : -(wd - 1));
}

export function weekDaysISO(dateISO: string): string[] {
  const start = startOfWeekISO(dateISO);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(addDaysISO(start, i));
  return out;
}

/** Valida "YYYY-MM-DD" de verdad: "2026-02-31" NO pasa. */
export function isValidDateISO(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const bits = value.split("-");
  const y = parseInt(bits[0], 10);
  const m = parseInt(bits[1], 10);
  const d = parseInt(bits[2], 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "09:30" a partir de minutos desde medianoche. */
export function minuteToLabel(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "09:30" → 570. Devuelve null si no es una hora válida. */
export function labelToMinute(value: string): number | null {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const bits = value.split(":");
  const h = parseInt(bits[0], 10);
  const m = parseInt(bits[1], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// ── 3. Rejilla ──────────────────────────────────────────────────────────

export const REALTY_SLOT_MINUTES = 15;
export const REALTY_DAY_PX_PER_MIN = 2;
export const REALTY_WEEK_PX_PER_MIN = 1.1;
export const REALTY_CARD_MIN_PX = 26;

/**
 * Duración NOMINAL de una visita, solo para dibujar el bloque.
 *
 * 🔴 RealtyVisit NO guarda duración ni hora de fin — es un instante. Enseñar
 * un bloque de alto fijo es honesto (todas miden lo mismo porque nadie
 * capturó cuánto duran) y evita inventar un `endAt` que la base no tiene.
 * Si algún día el schema gana una duración, este número deja de usarse.
 */
export const REALTY_VISIT_BLOCK_MIN = 45;

export const REALTY_DEFAULT_DAY_START_MIN = 8 * 60;
export const REALTY_DEFAULT_DAY_END_MIN = 20 * 60;

export interface MinuteWindow {
  start: number;
  end: number;
}

/**
 * Ventana vertical de la rejilla. Se calcula CON las visitas dentro, para
 * que una visita a las 7:00 o a las 21:30 nunca desaparezca de la pantalla
 * por caer fuera del horario "normal" — ese bug ya lo pagó el dental.
 */
export function computeVisitGridBounds(visitMinutes: number[]): MinuteWindow {
  let start = REALTY_DEFAULT_DAY_START_MIN;
  let end = REALTY_DEFAULT_DAY_END_MIN;
  for (let i = 0; i < visitMinutes.length; i++) {
    const m = visitMinutes[i];
    if (!Number.isFinite(m)) continue;
    if (m < start) start = m;
    if (m + REALTY_VISIT_BLOCK_MIN > end) end = m + REALTY_VISIT_BLOCK_MIN;
  }
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  if (end - start < 4 * 60) end = Math.min(24 * 60, start + 4 * 60);
  return { start, end };
}

export function snapMinute(minute: number, step: number = REALTY_SLOT_MINUTES): number {
  return Math.round(minute / step) * step;
}

/**
 * Reparte en carriles las visitas que se encabalgan, para que dos a la
 * misma hora no se tapen. Entra ordenado por minuto; sale el carril de cada
 * una y cuántos carriles hay en su grupo.
 */
export function assignVisitLanes(
  minutes: number[],
): { lane: number; laneCount: number }[] {
  const out: { lane: number; laneCount: number }[] = new Array(minutes.length);
  const order: number[] = [];
  for (let i = 0; i < minutes.length; i++) order.push(i);
  order.sort((a, b) => minutes[a] - minutes[b]);

  let cluster: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const lanes: number[] = [];
    for (let i = 0; i < cluster.length; i++) {
      const idx = cluster[i];
      const start = minutes[idx];
      let lane = -1;
      for (let l = 0; l < laneEnds.length; l++) {
        if (laneEnds[l] <= start) {
          lane = l;
          break;
        }
      }
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = start + REALTY_VISIT_BLOCK_MIN;
      lanes.push(lane);
    }
    const laneCount = Math.max(1, laneEnds.length);
    for (let i = 0; i < cluster.length; i++) out[cluster[i]] = { lane: lanes[i], laneCount };
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const start = minutes[idx];
    if (cluster.length > 0 && start >= clusterEnd) flush();
    cluster.push(idx);
    clusterEnd = Math.max(clusterEnd, start + REALTY_VISIT_BLOCK_MIN);
  }
  flush();

  for (let i = 0; i < out.length; i++) {
    if (!out[i]) out[i] = { lane: 0, laneCount: 1 };
  }
  return out;
}

// ── 4. Retroalimentación ────────────────────────────────────────────────

export const REALTY_VISIT_OUTCOMES = [
  "LE_GUSTO",
  "PRECIO_ALTO",
  "NO_LE_GUSTO",
  "NO_ERA",
] as const;

export type RealtyVisitOutcome = (typeof REALTY_VISIT_OUTCOMES)[number];

/**
 * 🔴 EL RESULTADO VIAJA DENTRO DE `feedback`, Y NO ES UN ATAJO.
 *
 * `RealtyVisit.feedback` es un `String? @db.Text` y el schema NO tiene
 * columna de resultado. Esta terminal no puede tocar schema.prisma, así que
 * el resultado se codifica en la PRIMERA LÍNEA con una marca reconocible y
 * la nota libre va debajo. Es exactamente lo que ya hace el vertical con
 * MARCA_BITACORA en las calculadoras y con el folio dentro de receiptUrl en
 * las rentas: dato estructurado dentro de un campo de texto, con UN solo
 * par de funciones que lo escriben y lo leen.
 *
 * Consecuencias que hay que tener presentes:
 *  · Un feedback viejo (o escrito a mano por fuera) NO trae marca: se lee
 *    como `{ outcome: null, note: <todo el texto> }` y no se pierde nada.
 *  · La nota NUNCA se guarda cruda si empieza por la marca — se escapa, o
 *    un prospecto podría inyectar un resultado escribiendo la marca en su
 *    comentario.
 */
const OUTCOME_MARK_RE = /^\[resultado:([A-Z_]{1,24})\]\n?/;

function isOutcome(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (REALTY_VISIT_OUTCOMES as readonly string[]).indexOf(value) !== -1
  );
}

/** Arma el texto que se guarda en `RealtyVisit.feedback`. */
export function formatVisitFeedback(
  outcome: RealtyVisitOutcome | null,
  note: string | null,
): string | null {
  const clean = typeof note === "string" ? note.trim() : "";
  // Se neutraliza una marca escrita a mano dentro de la nota: si no, el
  // texto del prospecto decidiría el resultado al releerlo.
  const safe = clean.replace(OUTCOME_MARK_RE, "");
  if (!outcome) return safe.length > 0 ? safe : null;
  return safe.length > 0 ? `[resultado:${outcome}]\n${safe}` : `[resultado:${outcome}]`;
}

/** Lee lo que hay en `RealtyVisit.feedback`. Nunca lanza. */
export function parseVisitFeedback(feedback: string | null | undefined): {
  outcome: RealtyVisitOutcome | null;
  note: string | null;
} {
  if (typeof feedback !== "string" || feedback.length === 0) {
    return { outcome: null, note: null };
  }
  const m = OUTCOME_MARK_RE.exec(feedback);
  if (!m) {
    const plain = feedback.trim();
    return { outcome: null, note: plain.length > 0 ? plain : null };
  }
  const rest = feedback.slice(m[0].length).trim();
  return {
    outcome: isOutcome(m[1]) ? (m[1] as RealtyVisitOutcome) : null,
    note: rest.length > 0 ? rest : null,
  };
}

// ── 5. Ruta del día ─────────────────────────────────────────────────────

export interface RouteStop {
  visitId: string;
  propertyId: string;
  title: string;
  /** Lo que se le pasa a Google Maps: dirección legible o "lat,lng". */
  query: string;
  lat: number | null;
  lng: number | null;
  scheduledAt: string;
  /** Km en línea recta desde la parada anterior. null en la primera. */
  legKm: number | null;
}

const EARTH_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distancia en línea recta. Para ordenar paradas sobra; no es una ruta real. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Dirección legible del inmueble; si no hay, las coordenadas. null si no hay ninguna. */
export function visitMapQuery(v: RealtyVisitCardDTO): string | null {
  const parts: string[] = [];
  if (v.propertyAddress) parts.push(v.propertyAddress);
  if (v.propertyColonia) parts.push(v.propertyColonia);
  if (v.propertyCity) parts.push(v.propertyCity);
  if (parts.length > 0) return parts.join(", ");
  if (typeof v.lat === "number" && typeof v.lng === "number") return `${v.lat},${v.lng}`;
  return null;
}

/**
 * Ordena las visitas del día por cercanía (vecino más próximo desde el
 * origen, normalmente la oficina).
 *
 * 🔴 ES UNA SUGERENCIA, NO LA AGENDA. La agenda manda: si el prospecto
 * quedó a las 11:00, ir primero al inmueble de al lado no sirve de nada. La
 * pantalla enseña las dos órdenes y avisa cuando difieren, en vez de fingir
 * que resolvió un problema del viajante.
 *
 * Las visitas sin coordenadas se van AL FINAL en orden de hora: no se
 * pueden ordenar por cercanía y esconderlas sería peor.
 */
export function orderVisitsByProximity(
  visits: RealtyVisitCardDTO[],
  origin: { lat: number; lng: number } | null,
): RouteStop[] {
  const geo: RealtyVisitCardDTO[] = [];
  const flat: RealtyVisitCardDTO[] = [];
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i];
    if (typeof v.lat === "number" && typeof v.lng === "number") geo.push(v);
    else flat.push(v);
  }

  const byTime = (a: RealtyVisitCardDTO, b: RealtyVisitCardDTO) =>
    a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0;
  geo.sort(byTime);
  flat.sort(byTime);

  const stops: RouteStop[] = [];
  const pending = geo.slice();
  // Sin oficina con coordenadas, se arranca en la PRIMERA visita por hora:
  // el asesor sale de donde sea, pero su primer compromiso es ése.
  let cursor: { lat: number; lng: number } | null = origin;

  while (pending.length > 0) {
    let bestIdx = 0;
    let bestKm: number | null = null;
    if (cursor) {
      for (let i = 0; i < pending.length; i++) {
        const km = haversineKm(cursor, {
          lat: pending[i].lat as number,
          lng: pending[i].lng as number,
        });
        if (bestKm === null || km < bestKm) {
          bestKm = km;
          bestIdx = i;
        }
      }
    }
    const chosen = pending.splice(bestIdx, 1)[0];
    stops.push({
      visitId: chosen.id,
      propertyId: chosen.propertyId,
      title: chosen.propertyTitle,
      query: visitMapQuery(chosen) ?? `${chosen.lat},${chosen.lng}`,
      lat: chosen.lat,
      lng: chosen.lng,
      scheduledAt: chosen.scheduledAt,
      legKm: cursor ? bestKm : null,
    });
    cursor = { lat: chosen.lat as number, lng: chosen.lng as number };
  }

  for (let i = 0; i < flat.length; i++) {
    const v = flat[i];
    const q = visitMapQuery(v);
    stops.push({
      visitId: v.id,
      propertyId: v.propertyId,
      title: v.propertyTitle,
      query: q ?? "",
      lat: null,
      lng: null,
      scheduledAt: v.scheduledAt,
      legKm: null,
    });
  }
  return stops;
}

/**
 * Tope de paradas intermedias de la liga de Google Maps. La API `dir` acepta
 * origen, destino y hasta 9 waypoints; pasarse hace que Maps abra la liga
 * SIN la ruta, que es peor que enseñar una ruta recortada y decirlo.
 */
export const REALTY_ROUTE_MAX_WAYPOINTS = 9;

/**
 * Liga de Google Maps con la ruta del día ya armada. `null` si no hay ni
 * una parada con dirección utilizable.
 *
 * Devuelve también cuántas paradas se quedaron fuera, para que la pantalla
 * lo DIGA en vez de fingir que van todas.
 */
export function buildMapsRouteUrl(
  stops: RouteStop[],
  origin: { query: string } | null,
): { url: string; included: number; dropped: number } | null {
  const usable = stops.filter((s) => typeof s.query === "string" && s.query.length > 0);
  if (usable.length === 0) return null;

  const maxStops = REALTY_ROUTE_MAX_WAYPOINTS + 1;
  const included = usable.slice(0, maxStops);
  const dropped = usable.length - included.length;

  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("travelmode", "driving");

  const destination = included[included.length - 1];
  const middle = included.slice(0, included.length - 1);

  if (origin && origin.query) {
    params.set("origin", origin.query);
    if (middle.length > 0) params.set("waypoints", middle.map((s) => s.query).join("|"));
  } else if (middle.length > 0) {
    params.set("origin", middle[0].query);
    const rest = middle.slice(1);
    if (rest.length > 0) params.set("waypoints", rest.map((s) => s.query).join("|"));
  }
  params.set("destination", destination.query);

  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    included: included.length,
    dropped,
  };
}

/** Liga a UN inmueble suelto (el botón de cada tarjeta). */
export function buildMapsPlaceUrl(query: string | null): string | null {
  if (typeof query !== "string" || query.length === 0) return null;
  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("query", query);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

// ── 6. Llaves ───────────────────────────────────────────────────────────

/**
 * A partir de cuántos días una llave fuera se considera olvidada.
 *
 * Es una CONSTANTE y no una preferencia de la cuenta a propósito: el schema
 * no tiene dónde guardarla y esta terminal no puede añadir columnas.
 * Inventar una tabla de ajustes para un número sería peor que un default
 * honesto. Siete días es "una semana y nadie la pidió de vuelta".
 */
export const REALTY_KEY_OVERDUE_DAYS = 7;

/** Días completos entre dos instantes. Nunca negativo. */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

import { createHmac, timingSafeEqual } from "crypto";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — núcleo PURO del portal del cliente (/i/portal).

   Sin prisma, sin next/headers, sin React: constantes, firma de la sesión,
   aritmética de dinero y de fechas, y el armado del estado de cuenta del
   propietario. Todo lo de aquí se puede probar sin base de datos.

   La capa con prisma y cookies es src/lib/realty/portal-auth.ts, que
   re-exporta este archivo entero.

   ── EL PORTAL TIENE DOS CARAS ────────────────────────────────────────
   Detrás del mismo teléfono pueden vivir dos relaciones distintas con la
   misma inmobiliaria:

     INQUILINO   → su contrato, sus pagos, su adeudo, sus fallas.
     PROPIETARIO → sus inmuebles, su estado de cuenta, sus mantenimientos.

   Son dos experiencias separadas y NO se mezclan nunca: la sesión guarda
   cuál de las dos eligió la persona, y cada consulta se acota a esa cara.
   Un inquilino no ve un solo peso de los números del propietario, y un
   propietario no ve los datos personales del inquilino más allá del
   nombre con el que firmó.

   ── POR QUÉ LA IDENTIDAD *NO* VIAJA COMPLETA EN LA COOKIE ────────────
   La cookie solo dice DOS cosas: qué teléfono se verificó, y con cuál de
   sus caras entró (rol + cuenta). NUNCA lleva el contactId, el ownerId ni
   la lista de contratos. Esos se vuelven a resolver contra la base en
   CADA petición (resolvePortalScope en portal-auth.ts).

   Cuesta una consulta indexada y compra tres cosas:
     · El día que la persona deja de ser inquilina, el portal se le cierra
       solo — sin esperar a que caduque una cookie de 30 días.
     · Un contrato nuevo aparece sin volver a entrar.
     · Si la misma persona está capturada dos veces en la misma cuenta
       (pasa), las dos filas caen bajo la misma sesión en vez de partirse
       en dos identidades que enseñan la mitad de sus pagos cada una.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Rutas y cookie ──────────────────────────────────────────────────────

/** Raíz del portal. `/i/portal` es un segmento ESTÁTICO: Next lo resuelve
 *  antes que el `/i/[slug]` de la web pública, así que no chocan. */
export const REALTY_PORTAL_BASE = "/i/portal" as const;

/**
 * 🔴 Nombre PROPIO. No comparte cookie con el panel (Supabase `sb-*`), ni
 * con el portal del paciente (`patient_session`), ni con el de barbería
 * (`dcb_portal`). El aislamiento entre productos depende de esto.
 */
export const REALTY_PORTAL_COOKIE = "dcr_portal";

// ── Parámetros del código de un solo uso ────────────────────────────────

/** Vida del código. Corta a propósito. */
export const PORTAL_CODE_TTL_MIN = 10;
/** Intentos fallidos contra UN código antes de quemarlo. */
export const PORTAL_CODE_MAX_ATTEMPTS = 5;
/** Códigos que un mismo teléfono puede pedir dentro de la ventana. */
export const PORTAL_CODE_MAX_PER_WINDOW = 3;
export const PORTAL_CODE_WINDOW_MIN = 15;
/**
 * Vida de la sesión. 30 días, igual que el portal del paciente: el
 * inquilino vuelve una vez al mes (cuando paga la renta) y obligarlo a
 * pedir un código nuevo cada visita convierte el portal en un trámite.
 */
export const PORTAL_SESSION_DAYS = 30;

/**
 * Techo ABSOLUTO de la sesión, contado desde el código, no desde la última
 * visita.
 *
 * 🔴 POR QUÉ HACE FALTA: la cookie se vuelve a emitir cada vez que alguien
 * cambia de cara (/auth/elegir), y cada emisión son 30 días nuevos. Sin un
 * techo, quien se hiciera con la cookie la renovaría para siempre y no hay
 * tabla de sesiones que revocar. A los 90 días se vuelve a pedir un código
 * — dos minutos de molestia, una vez por trimestre.
 */
export const PORTAL_SESSION_MAX_DAYS = 90;

/**
 * Copy ÚNICO de "pedí un código". IDÉNTICO exista o no el teléfono: si
 * cambiara, cualquiera podría preguntarle al portal quién es inquilino de
 * quién probando números.
 */
export const PORTAL_CODE_SENT_MESSAGE =
  "Si tu número está registrado, te llega un código por WhatsApp.";

/** Copy ÚNICO de "ese código no sirve". Igual para TODO lo que falla. */
export const PORTAL_INVALID_CODE_MESSAGE =
  "Ese código no es válido o ya venció. Pide uno nuevo.";

// ── Identidad: rol + cuenta ─────────────────────────────────────────────

export type RealtyPortalRole = "INQUILINO" | "PROPIETARIO";

export function isRealtyPortalRole(v: unknown): v is RealtyPortalRole {
  return v === "INQUILINO" || v === "PROPIETARIO";
}

/**
 * Llave estable de una identidad = rol + cuenta. NO lleva el id de la
 * persona a propósito (ver el encabezado): la persona se identifica por el
 * teléfono verificado de la sesión.
 */
export function portalIdentityKey(role: RealtyPortalRole, accountId: string): string {
  return `${role}:${accountId}`;
}

export function parsePortalIdentityKey(
  raw: unknown,
): { role: RealtyPortalRole; accountId: string } | null {
  if (typeof raw !== "string") return null;
  const idx = raw.indexOf(":");
  if (idx < 1) return null;
  const role = raw.slice(0, idx);
  const accountId = raw.slice(idx + 1);
  if (!isRealtyPortalRole(role) || !accountId || accountId.includes(".")) return null;
  return { role, accountId };
}

// ── Sesión: cookie firmada, sin tabla ───────────────────────────────────

export interface RealtyPortalSession {
  /** Los 10 dígitos verificados por código. Es la identidad de la persona. */
  phone: string;
  /** null = verificó el código pero todavía no elige con cuál cara entrar. */
  role: RealtyPortalRole | null;
  /** null junto con `role`. */
  accountId: string | null;
  /** Cuándo se tecleó el código. NO se renueva: es el techo absoluto. */
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * Llave de firma. Cascada declarada, con UNA diferencia importante
 * respecto de los otros portales del repo:
 *
 * 🔴 EN PRODUCCIÓN FALLA CERRADO. Los helpers gemelos (barber, clínica
 * activa, live-unlock) caen a un literal de desarrollo cuando no hay
 * ninguna variable puesta — y ese literal está en el repositorio, así que
 * cualquiera podría fabricarse una cookie válida. Aquí no: sin secreto,
 * en producción, no se emite ni se acepta ninguna sesión. El portal se ve
 * "no puedo entrar", que es infinitamente mejor que "entra cualquiera".
 *
 * Fuera de producción sí hay literal, para poder probar el flujo en local
 * sin configurar nada.
 */
export function portalSecret(): string | null {
  const fromEnv = process.env.COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return null;
  return "dalecontrol-realty-portal-dev-only";
}

function sign(payload: string): string | null {
  const secret = portalSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Arma el valor de la cookie. `chosen` en null = sesión a medias (código
 * ya verificado, cara sin elegir): solo sirve para la pantalla de elegir y
 * para el endpoint que la fija.
 *
 * Devuelve null si no hay secreto (producción sin configurar): quien llame
 * DEBE tratarlo como "no se pudo abrir la sesión".
 */
export function packPortalSession(
  phone: string,
  chosen: { role: RealtyPortalRole; accountId: string } | null,
  now: Date = new Date(),
  /**
   * Cuándo se tecleó el código. Al RE-emitir la cookie (cambio de cara) se
   * pasa el original: así la renovación mueve la caducidad pero NO el techo
   * absoluto. Sin argumento = sesión nueva.
   */
  issuedAt: Date = now,
): { value: string; expiresAt: Date } | null {
  if (!/^\d{10}$/.test(phone)) return null;
  if (chosen && (!chosen.accountId || chosen.accountId.includes("."))) return null;
  const nacida = issuedAt.getTime();
  if (!Number.isFinite(nacida)) return null;
  // Techo absoluto: pasados los 90 días se vuelve a pedir código.
  if (now.getTime() - nacida > PORTAL_SESSION_MAX_DAYS * 86_400_000) return null;
  const expiresAt = new Date(
    Math.min(
      now.getTime() + PORTAL_SESSION_DAYS * 86_400_000,
      nacida + PORTAL_SESSION_MAX_DAYS * 86_400_000,
    ),
  );
  const role = chosen ? chosen.role : "-";
  const accountId = chosen ? chosen.accountId : "-";
  const payload = `v1.${phone}.${role}.${accountId}.${nacida}.${expiresAt.getTime()}`;
  const mac = sign(payload);
  if (!mac) return null;
  return { value: `${payload}.${mac}`, expiresAt };
}

/**
 * Lee y valida el valor de la cookie. Null ante CUALQUIER duda: firma que
 * no cuadra, versión desconocida, caducada, formato raro o sin secreto.
 */
export function readPortalSession(raw: string | undefined | null): RealtyPortalSession | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 1) return null;
  const payload = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(payload);
  if (!expected) return null;
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const partes = payload.split(".");
  // Exactamente seis campos. Un punto de más o de menos NO se interpreta
  // "lo mejor posible": se rechaza.
  if (partes.length !== 6) return null;
  const [version, phone, role, accountId, iatMs, expMs] = partes;
  if (version !== "v1") return null;
  if (!phone || !/^\d{10}$/.test(phone)) return null;
  const issuedAt = new Date(Number(iatMs));
  const expiresAt = new Date(Number(expMs));
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) return null;
  if (expiresAt.getTime() <= Date.now()) return null;
  // Techo absoluto, por si alguien conservó una cookie vieja.
  if (Date.now() - issuedAt.getTime() > PORTAL_SESSION_MAX_DAYS * 86_400_000) return null;

  // Sesión a medias: los dos campos van juntos o ninguno.
  if (role === "-" || accountId === "-") {
    if (role !== "-" || accountId !== "-") return null;
    return { phone, role: null, accountId: null, issuedAt, expiresAt };
  }
  if (!isRealtyPortalRole(role) || !accountId) return null;
  return { phone, role, accountId, issuedAt, expiresAt };
}

export function portalCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

// ── CSRF ────────────────────────────────────────────────────────────────

/**
 * El middleware solo comprueba el origen en /api/admin/*. Los portales del
 * repo se apoyan únicamente en `sameSite: "lax"` (que ya frena el POST
 * entre sitios). Aquí se añade la comprobación explícita: cuesta nada y
 * este portal SÍ tiene mutaciones (reportar una falla, elegir con qué cara
 * entrar, cerrar sesión).
 *
 * Puro: recibe las tres cabeceras, no el request.
 */
export function portalOriginMismatch(headers: {
  origin: string | null;
  referer: string | null;
  host: string | null;
}): boolean {
  if (!headers.host) return true;
  const source = (() => {
    try {
      if (headers.origin) return new URL(headers.origin).host;
      if (headers.referer) return new URL(headers.referer).host;
      return null;
    } catch {
      return null;
    }
  })();
  if (!source) return true;
  return source !== headers.host;
}

// ── Lista BLANCA de salida de la cuenta ─────────────────────────────────

/**
 * Los ÚNICOS campos de la inmobiliaria que salen al navegador del
 * inquilino o del propietario. Lista blanca y no lista negra: un campo
 * nuevo en RealtyAccount (un token de WhatsApp, un id de Stripe) NO se
 * filtra por olvido.
 */
export const PORTAL_ACCOUNT_FIELDS = [
  "id",
  "name",
  "slug",
  "phone",
  "email",
  "city",
  "state",
  "timezone",
  "logoUrl",
] as const;

export interface PortalAccountDTO {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  logoUrl: string | null;
}

/** Recorta CUALQUIER fila a la lista blanca. Lo que no está, no sale. */
export function pickPortalAccount(row: Record<string, unknown>): PortalAccountDTO {
  const out: Record<string, unknown> = {};
  for (const key of PORTAL_ACCOUNT_FIELDS) out[key] = row[key] ?? null;
  out.timezone = (row.timezone as string) || "America/Mexico_City";
  return out as unknown as PortalAccountDTO;
}

// ── Dinero ──────────────────────────────────────────────────────────────
//
// Los montos del vertical son Decimal(14,2) en Postgres y llegan como
// number tras Number(). Sumarlos con `+` a secas arrastra el error binario
// (0.1 + 0.2 = 0.30000000000000004) y en un estado de cuenta de doce
// meses eso sale impreso. Todo se suma en CENTAVOS enteros.

/** Redondea a centavos exactos (2 decimales). */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Suma en centavos enteros. Ignora lo que no sea número finito. */
export function sumMoney(values: Array<number | null | undefined>): number {
  let cents = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    cents += Math.round(v * 100);
  }
  return cents / 100;
}

/** "$12,500.00". Español de México, sin decimales sorpresa. */
export function formatMoney(n: number, currency: "MXN" | "USD" = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(n));
}

// ── Fechas civiles (la zona de la inmobiliaria, no la del servidor) ─────
//
// "Llevas 12 días de retraso" se cuenta en DÍAS DE CALENDARIO de la zona
// de la cuenta, no en múltiplos de 24 horas desde un instante UTC. Con
// horario de verano de por medio las dos cuentas no dan lo mismo, y la que
// le importa al inquilino es la del calendario que tiene colgado.

/** Fecha civil "YYYY-MM-DD" de un instante, en la zona dada. */
export function civilDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Días de calendario de `from` a `to` (positivo si `to` es posterior). */
export function civilDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Desfase de la zona respecto de UTC, en ms, para ese instante. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/**
 * Medianoche civil de (y, m, d) en la zona dada, como instante UTC.
 * Dos pasadas: la primera estima el desfase, la segunda lo corrige para
 * los dos domingos del año en que cambia el horario.
 */
export function zonedCivilToUtc(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  const second = guess - tzOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** ¿"YYYY-MM" bien escrito? */
export function isPeriodMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/**
 * El mes `YYYY-MM` como intervalo semiabierto [inicio, fin) en instantes
 * UTC, medido en la zona de la inmobiliaria. Null si el mes viene mal.
 */
export function monthRange(
  periodMonth: string,
  timeZone: string,
): { start: Date; end: Date } | null {
  if (!isPeriodMonth(periodMonth)) return null;
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: zonedCivilToUtc(y, m, 1, timeZone),
    end: zonedCivilToUtc(nextY, nextM, 1, timeZone),
  };
}

/** "YYYY-MM" del mes al que pertenece ese instante en la zona dada. */
export function periodMonthOf(date: Date, timeZone: string): string {
  return civilDate(date, timeZone).slice(0, 7);
}

/** El mes anterior/siguiente a "YYYY-MM". `delta` en meses. */
export function shiftPeriodMonth(periodMonth: string, delta: number): string {
  if (!isPeriodMonth(periodMonth)) return periodMonth;
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** "5 de septiembre" / "5 de septiembre de 2025" desde una fecha civil. */
export function formatCivilDate(
  isoDay: string,
  opts: { withYear?: boolean } = {},
): string {
  const ts = Date.parse(`${isoDay}T12:00:00Z`);
  if (!Number.isFinite(ts)) return isoDay;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    ...(opts.withYear ? { year: "numeric" } : {}),
  }).format(new Date(ts));
}

/** "septiembre de 2025" desde "YYYY-MM". */
export function formatPeriodMonth(periodMonth: string): string {
  if (!isPeriodMonth(periodMonth)) return periodMonth;
  const ts = Date.parse(`${periodMonth}-15T12:00:00Z`);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(ts));
}

// ── El adeudo, dicho sin dramatismo ─────────────────────────────────────

export type PortalDueTone = "alCorriente" | "porVencer" | "venceHoy" | "retraso";

export interface PortalDueState {
  tone: PortalDueTone;
  /** Días de RETRASO. 0 si vence hoy o si aún no vence. */
  daysLate: number;
  /** Días que FALTAN para el vencimiento. 0 si ya venció o vence hoy. */
  daysLeft: number;
  /** Fecha civil de vencimiento, en la zona de la inmobiliaria. */
  dueDate: string;
}

/**
 * Estado de un cargo respecto de hoy.
 *
 * 🔴 Esto NO decide colores de alarma. La pantalla usa ámbar sobrio hasta
 * en el peor caso: quien entra aquí ya sabe que debe la renta y está
 * estresado; unas letras rojas gigantes no le consiguen el dinero, solo lo
 * humillan. El tono más fuerte que existe es "retraso".
 */
export function dueState(dueAt: Date, now: Date, timeZone: string): PortalDueState {
  const dueDate = civilDate(dueAt, timeZone);
  const today = civilDate(now, timeZone);
  const diff = civilDaysBetween(dueDate, today); // >0 → ya pasó
  if (diff > 0) return { tone: "retraso", daysLate: diff, daysLeft: 0, dueDate };
  if (diff === 0) return { tone: "venceHoy", daysLate: 0, daysLeft: 0, dueDate };
  return { tone: "porVencer", daysLate: 0, daysLeft: -diff, dueDate };
}

/** Los cargos que todavía deben algo. PAGADO nunca entra. */
export function isChargeOpen(status: string): boolean {
  return status === "PENDIENTE" || status === "PARCIAL" || status === "VENCIDO";
}

// ── Estado de cuenta del propietario ────────────────────────────────────

export interface OwnerStatementInputRent {
  propertyId: string;
  /** Lo efectivamente COBRADO al inquilino en el mes. */
  amount: number;
  /** Comisión de administración del inmueble, en % (0 si no hay pactada). */
  commissionPct: number;
}

export interface OwnerStatementInputExpense {
  propertyId: string;
  amount: number;
}

export interface OwnerStatementProperty {
  propertyId: string;
  cobrado: number;
  retenido: number;
  gastos: number;
  depositado: number;
  commissionPct: number;
}

export interface OwnerStatement {
  periodMonth: string;
  cobrado: number;
  retenido: number;
  gastos: number;
  depositado: number;
  /** true si NINGÚN inmueble del corte tiene comisión pactada. */
  sinComisionPactada: boolean;
  porInmueble: OwnerStatementProperty[];
}

/**
 * El corte del mes: lo cobrado, lo retenido por administración, los gastos
 * y lo que queda para el propietario.
 *
 *   depositado = cobrado − retenido − gastos
 *
 * 🔴 DOS DECISIONES QUE SON DINERO, ESCRITAS AQUÍ PARA QUE NO SE PIERDAN:
 *
 * 1. La retención sale de `RealtyProperty.commissionPct` — el porcentaje
 *    pactado en la ficha del inmueble. Si está vacío, la retención es CERO
 *    y el estado de cuenta lo dice con todas sus letras. Inventar un
 *    porcentaje "de mercado" sería cobrarle al propietario algo que nadie
 *    pactó.
 *
 * 2. Los gastos salen SOLO de RealtyExpense, que es la tabla cuyo propio
 *    contrato dice "es lo que se le resta al propietario en su corte". El
 *    `cost` de RealtyMaintenance NO se resta aquí: cuando la inmobiliaria
 *    paga esa reparación, la captura como gasto (kind REPARACION o
 *    MANTENIMIENTO) y restarla otra vez le cobraría al propietario dos
 *    veces la misma plomería. El costo del mantenimiento se ENSEÑA en su
 *    sección, informativo, y la pantalla lo dice.
 *
 * Puro y probable sin base de datos: recibe filas ya leídas.
 */
export function buildOwnerStatement(args: {
  periodMonth: string;
  rents: OwnerStatementInputRent[];
  expenses: OwnerStatementInputExpense[];
  /**
   * TODOS los inmuebles del propietario con su comisión pactada — no solo
   * los que tuvieron movimiento.
   *
   * 🔴 Es lo que decide `sinComisionPactada`, y por eso NO puede salir de
   * los pagos: un mes en que nadie pagó pero sí hubo predial imprimiría
   * "no hay comisión pactada en tus inmuebles" en el PDF que el propietario
   * guarda, siendo falso — sí está pactada, simplemente no se cobró nada.
   */
  properties: Array<{ propertyId: string; commissionPct: number }>;
}): OwnerStatement {
  const porInmueble = new Map<string, OwnerStatementProperty>();
  const ensure = (propertyId: string): OwnerStatementProperty => {
    let row = porInmueble.get(propertyId);
    if (!row) {
      row = {
        propertyId,
        cobrado: 0,
        retenido: 0,
        gastos: 0,
        depositado: 0,
        commissionPct: 0,
      };
      porInmueble.set(propertyId, row);
    }
    return row;
  };

  // La comisión pactada se fija con la CARTERA, no con los cobros.
  let algunaComision = false;
  for (const p of args.properties) {
    const row = ensure(p.propertyId);
    const pct = Number.isFinite(p.commissionPct) && p.commissionPct > 0 ? p.commissionPct : 0;
    row.commissionPct = pct;
    if (pct > 0) algunaComision = true;
  }

  // Centavos enteros durante toda la acumulación.
  const cobradoCents = new Map<string, number>();
  const retenidoCents = new Map<string, number>();
  const gastosCents = new Map<string, number>();

  for (const r of args.rents) {
    const row = ensure(r.propertyId);
    const pct = Number.isFinite(r.commissionPct) && r.commissionPct > 0 ? r.commissionPct : 0;
    if (pct > 0) row.commissionPct = pct;
    const cents = Math.round((Number.isFinite(r.amount) ? r.amount : 0) * 100);
    cobradoCents.set(r.propertyId, (cobradoCents.get(r.propertyId) ?? 0) + cents);
    // La comisión se calcula sobre CADA cobro y se redondea al centavo:
    // así la suma de las líneas cuadra con el total, sin un peso suelto
    // que el propietario no sepa explicar.
    retenidoCents.set(
      r.propertyId,
      (retenidoCents.get(r.propertyId) ?? 0) + Math.round((cents * pct) / 100),
    );
  }

  for (const e of args.expenses) {
    const row = ensure(e.propertyId);
    void row;
    const cents = Math.round((Number.isFinite(e.amount) ? e.amount : 0) * 100);
    gastosCents.set(e.propertyId, (gastosCents.get(e.propertyId) ?? 0) + cents);
  }

  let totalCobrado = 0;
  let totalRetenido = 0;
  let totalGastos = 0;

  // Array.from y NO un for-of directo sobre el iterador: el tsconfig del
  // repo no fija `target`, así que iterar un Map/Set saca TS2802 en
  // `tsc --noEmit`.
  for (const row of Array.from(porInmueble.values())) {
    const c = cobradoCents.get(row.propertyId) ?? 0;
    const r = retenidoCents.get(row.propertyId) ?? 0;
    const g = gastosCents.get(row.propertyId) ?? 0;
    row.cobrado = c / 100;
    row.retenido = r / 100;
    row.gastos = g / 100;
    row.depositado = (c - r - g) / 100;
    totalCobrado += c;
    totalRetenido += r;
    totalGastos += g;
  }

  const ordered = Array.from(porInmueble.values()).sort((a, b) =>
    b.cobrado - a.cobrado || a.propertyId.localeCompare(b.propertyId),
  );

  return {
    periodMonth: args.periodMonth,
    cobrado: totalCobrado / 100,
    retenido: totalRetenido / 100,
    gastos: totalGastos / 100,
    depositado: (totalCobrado - totalRetenido - totalGastos) / 100,
    sinComisionPactada: !algunaComision,
    porInmueble: ordered,
  };
}

// ── Reportar una falla ──────────────────────────────────────────────────

/** Tope de fotos por reporte. Se sube desde el celular, con datos móviles. */
export const PORTAL_ISSUE_MAX_PHOTOS = 4;
/**
 * Tope por foto. El navegador las manda comprimidas a WebP ≤1600 px
 * (≈300 KB), así que 4 MB es techo de seguridad, no de operación.
 */
export const PORTAL_ISSUE_MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/**
 * Tope de TODA la petición. Sin él, cuatro fotos en el tope individual son
 * 16 MB de bucket por reporte rechazado — y el cuerpo de una petición
 * serverless no pasa de ~4.5 MB, así que esto ni siquiera limita nada real:
 * corta el abuso, no al inquilino.
 */
export const PORTAL_ISSUE_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const PORTAL_ISSUE_MAX_CHARS = 1000;
export const PORTAL_ISSUE_MIN_CHARS = 10;
/** Reportes abiertos que un contrato puede tener a la vez. Freno de spam. */
export const PORTAL_ISSUE_MAX_OPEN = 10;

/**
 * 🔴 SIN image/heic. No es un descuido: el bucket realty-files se creó con
 * allowed_mime_types = webp, jpeg, png, mp4, pdf (sql/realty.sql), así que
 * un HEIC de iPhone lo rechazaría Supabase con un error críptico DESPUÉS
 * de que la persona ya subió la foto por datos móviles. El navegador lo
 * convierte a WebP antes de mandarlo (ver portal-reportar-falla.tsx); el
 * `accept` del input sí deja escoger HEIC para que iOS ofrezca la foto.
 */
export const PORTAL_PHOTO_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

export function isAllowedPhotoType(mime: unknown): boolean {
  return typeof mime === "string" && (PORTAL_PHOTO_TYPES as readonly string[]).includes(mime);
}

export function photoExtension(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "webp";
}

/**
 * El tipo REAL del archivo, por su firma de bytes.
 *
 * 🔴 El Content-Type de una parte multipart lo escribe el CLIENTE: decir
 * "image/webp" y mandar un .exe cuesta una línea de curl. Esto lee los
 * primeros bytes, que no se pueden mentir sin dejar de ser esa imagen.
 * Devuelve null si no es ninguno de los tres tipos que acepta el bucket.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Limpia la descripción de la falla. Null si no dice nada útil. */
export function normalizeIssueText(raw: unknown): string | null {
  const text = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, PORTAL_ISSUE_MAX_CHARS);
  if (text.length < PORTAL_ISSUE_MIN_CHARS) return null;
  return text;
}

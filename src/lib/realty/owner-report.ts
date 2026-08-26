/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — ARITMÉTICA y LECTURA de los reportes.
 *
 * Módulo PURO y CLIENT-SAFE a propósito (sin prisma, sin "server-only"): la
 * pantalla del reporte, la ruta que arma el PDF y la que exporta la hoja de
 * cálculo tienen que decir EXACTAMENTE el mismo número. Si cada superficie
 * sumara por su cuenta, el PDF que se le manda al propietario y la pantalla
 * que ve el asesor acabarían discrepando, y el que queda mal es el asesor
 * enfrente de su cliente.
 *
 * ── 🔴 LA REGLA QUE MANDA: NO SE SUMAN PESOS CON DÓLARES ────────────────
 * El inventario acepta MXN y USD (RealtyProperty.currency, RealtyLease.
 * currency) y NINGÚN movimiento de dinero guarda su moneda: ni
 * RealtyPayment, ni RealtyRentCharge, ni RealtyExpense, ni RealtyDeal, ni
 * RealtyCommissionSplit. La moneda SIEMPRE se hereda —del inmueble o del
 * contrato— y por eso es tan fácil perderla por el camino y acabar sumando
 * un dólar como si fuera un peso.
 *
 * T4 ya se comió ese bug en cobranza (commit 2ba44ae6) y lo resolvió
 * SEGREGANDO: un tablero, una moneda. Aquí se hace lo mismo pero sin
 * esconder nada, porque un reporte de patrimonio que ocultara los inmuebles
 * en dólares mentiría por omisión: los totales viajan en `MoneyByCurrency`,
 * un cajón POR MONEDA que nunca se colapsa a un solo número.
 *
 * Y NO se convierte. En este sistema no existe un tipo de cambio —ni tabla,
 * ni captura, ni fuente— y inventarle uno al reporte sería inventar el
 * número. Cuando hay dos monedas se pintan dos renglones. Un porcentaje de
 * rendimiento solo se calcula DENTRO de una moneda; si los ingresos de un
 * inmueble están en una y sus gastos en otra, el porcentaje NO se emite y se
 * dice por qué (ver `computeYield`).
 *
 * ── CENTAVOS ENTEROS, NUNCA FLOAT ──────────────────────────────────────
 * Todo lo que se llame `...Cents` es un entero. El redondeo ocurre UNA vez,
 * al presentar. La aritmética se apoya en `toCents`/`centsToNumber` de
 * rent-charges.ts, que trabajan sobre el TEXTO del Decimal y no heredan el
 * error binario de `Math.round(x * 100)`.
 *
 * ── EL TEXTO DE NEGOCIO VA EN ESPAÑOL ──────────────────────────────────
 * `buildOwnerRecommendation` devuelve prosa con números interpolados, no
 * etiquetas. Misma convención que src/lib/realty/calc/*.ts: las etiquetas
 * viven en el diccionario (reports.json, es/en) y las explicaciones largas
 * se generan aquí en español de México.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type {
  RealtyCurrency,
  RealtyPropertyKind,
  RealtyVisitStatus,
} from "@/lib/realty/types";
import {
  centsToNumber,
  formatCents,
  toCents,
  type MoneyLike,
} from "@/lib/realty/rent-charges";

// ═══════════════════════════════════════════════════════════════════════
// 1. DINERO POR MONEDA
// ═══════════════════════════════════════════════════════════════════════

export const REALTY_REPORT_CURRENCIES: readonly RealtyCurrency[] = ["MXN", "USD"];

/**
 * Totales en CENTAVOS enteros, un cajón por moneda. Es el tipo que impide
 * el bug: no hay ningún `number` suelto que represente "el total" y al que
 * alguien pueda sumarle un importe de otra moneda sin darse cuenta.
 */
export type MoneyByCurrency = Record<RealtyCurrency, number>;

export function emptyMoney(): MoneyByCurrency {
  return { MXN: 0, USD: 0 };
}

/** ¿Es una moneda que este vertical maneja? Cualquier otra cosa cae a MXN. */
export function asCurrency(value: unknown): RealtyCurrency {
  return value === "USD" ? "USD" : "MXN";
}

/** Suma centavos enteros al cajón de SU moneda. Muta y devuelve. */
export function addCents(
  into: MoneyByCurrency,
  currency: RealtyCurrency,
  cents: number,
): MoneyByCurrency {
  if (!Number.isFinite(cents)) return into;
  into[asCurrency(currency)] += Math.round(cents);
  return into;
}

/** addCents desde un Decimal de Prisma / string / number. */
export function addAmount(
  into: MoneyByCurrency,
  currency: RealtyCurrency,
  value: MoneyLike,
): MoneyByCurrency {
  return addCents(into, currency, toCents(value));
}

/** a + b, cajón por cajón. Devuelve uno nuevo. */
export function mergeMoney(a: MoneyByCurrency, b: MoneyByCurrency): MoneyByCurrency {
  return { MXN: a.MXN + b.MXN, USD: a.USD + b.USD };
}

/** a − b, cajón por cajón. Puede quedar negativo (un corte en rojo lo está). */
export function subtractMoney(a: MoneyByCurrency, b: MoneyByCurrency): MoneyByCurrency {
  return { MXN: a.MXN - b.MXN, USD: a.USD - b.USD };
}

export function sumMoneyList(items: readonly MoneyByCurrency[]): MoneyByCurrency {
  const out = emptyMoney();
  for (const m of items) {
    out.MXN += m.MXN;
    out.USD += m.USD;
  }
  return out;
}

/** Monedas con algo distinto de cero. Vacío = no hubo movimiento. */
export function activeCurrencies(m: MoneyByCurrency): RealtyCurrency[] {
  const out: RealtyCurrency[] = [];
  for (const c of REALTY_REPORT_CURRENCIES) {
    if (m[c] !== 0) out.push(c);
  }
  return out;
}

export function moneyIsEmpty(m: MoneyByCurrency): boolean {
  return m.MXN === 0 && m.USD === 0;
}

/**
 * La única moneda con movimiento, o null si hay dos (o ninguna). Es la
 * puerta que usa la UI para decidir si puede pintar UN número grande o si
 * tiene que pintar dos renglones. Mismo criterio que el `monedaUnica` del
 * portal del propietario.
 */
export function soleCurrency(m: MoneyByCurrency): RealtyCurrency | null {
  const act = activeCurrencies(m);
  return act.length === 1 ? act[0] : null;
}

/** ¿Hay dinero en las DOS monedas? Entonces ningún total único es honesto. */
export function isMixedCurrency(m: MoneyByCurrency): boolean {
  return activeCurrencies(m).length > 1;
}

/**
 * "$12,000.00" · "$12,000.00 y US$3,500.00" · "$0.00".
 * Nunca colapsa dos monedas en un solo importe.
 */
export function formatMoneyByCurrency(
  m: MoneyByCurrency,
  opts: { zero?: string; join?: string } = {},
): string {
  const act = activeCurrencies(m);
  if (act.length === 0) return opts.zero ?? formatCents(0, "MXN");
  return act.map((c) => formatCents(m[c], c)).join(opts.join ?? " y ");
}

/** Los cajones como renglones listos para pintar. Solo los que tienen algo. */
export function moneyRows(
  m: MoneyByCurrency,
): Array<{ currency: RealtyCurrency; cents: number; amount: number; label: string }> {
  return activeCurrencies(m).map((c) => ({
    currency: c,
    cents: m[c],
    amount: centsToNumber(m[c]),
    label: formatCents(m[c], c),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// 2. RENDIMIENTO — el número que el dueño de 10 casas nunca ha visto
// ═══════════════════════════════════════════════════════════════════════

export type YieldBlockedReason =
  | "SIN_VALOR" // no hay precio de lista con el que dividir
  | "MEZCLA_MONEDAS" // renta y gastos (o valor) en monedas distintas
  | "SIN_INGRESO"; // no hubo un solo peso de renta en el periodo

/**
 * Rendimiento de UN inmueble. Los tres importes son de la MISMA moneda o el
 * porcentaje no sale: dividir una renta en dólares entre un valor en pesos
 * da un número con forma de porcentaje que no significa nada.
 */
export interface YieldResult {
  currency: RealtyCurrency | null;
  valueCents: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Rendimiento neto anualizado, en por ciento. null = no se puede emitir. */
  netPct: number | null;
  /** Rendimiento bruto (sin restar gastos), en por ciento. */
  grossPct: number | null;
  blocked: YieldBlockedReason | null;
}

/**
 * (ingresos − gastos) / valor × 100, anualizado por los meses del periodo.
 *
 * Caso de prueba del enunciado: renta 12,000/mes durante 12 meses = 144,000
 * de ingreso, 2,000/mes de gastos = 24,000, valor 2,000,000.
 *   (144,000 − 24,000) / 2,000,000 = 6.0 % anual. ✔
 *
 * `months` es el largo del periodo medido; con 12 no anualiza nada, con 6
 * multiplica por 2 para que un corte semestral se pueda comparar con uno
 * anual. Se redondea a un decimal SOLO al final.
 */
export function computeYield(args: {
  currency: RealtyCurrency | null;
  valueCents: number;
  income: MoneyByCurrency;
  expenses: MoneyByCurrency;
  months: number;
}): YieldResult {
  const { currency, valueCents } = args;
  const months = args.months > 0 ? args.months : 12;

  // Si el ingreso o el gasto viven en una moneda distinta de la del valor,
  // el porcentaje NO se emite. Se dice qué pasó y se pintan los importes por
  // separado: un dato incompleto es mejor que un dato falso.
  const incomeCur = activeCurrencies(args.income);
  const expenseCur = activeCurrencies(args.expenses);
  const foreign = incomeCur
    .concat(expenseCur)
    .filter((c) => currency !== null && c !== currency);

  const incomeCents = currency ? args.income[currency] : 0;
  const expenseCents = currency ? args.expenses[currency] : 0;
  const netCents = incomeCents - expenseCents;

  let blocked: YieldBlockedReason | null = null;
  if (foreign.length > 0) blocked = "MEZCLA_MONEDAS";
  else if (!currency || valueCents <= 0) blocked = "SIN_VALOR";
  else if (incomeCents === 0) blocked = "SIN_INGRESO";

  const factor = 12 / months;
  const netPct =
    blocked === null ? round1((netCents * factor * 100) / valueCents) : null;
  const grossPct =
    blocked === null ? round1((incomeCents * factor * 100) / valueCents) : null;

  return {
    currency,
    valueCents,
    incomeCents,
    expenseCents,
    netCents,
    netPct,
    grossPct,
    blocked,
  };
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/** "6 %" · "6.4 %" · "—" cuando no se pudo emitir. */
export function formatPctOrDash(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const s = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${s} %`;
}

/** Por qué no hay porcentaje, en español y sin culpar al usuario. */
export function yieldBlockedText(reason: YieldBlockedReason | null): string | null {
  if (reason === null) return null;
  if (reason === "MEZCLA_MONEDAS") {
    return (
      "El rendimiento no se puede expresar en un solo porcentaje: los ingresos y " +
      "los gastos de este inmueble están en monedas distintas. Abajo van los " +
      "importes separados por moneda."
    );
  }
  if (reason === "SIN_VALOR") {
    return "Falta el precio del inmueble para poder calcular el rendimiento.";
  }
  return "En el periodo elegido no se cobró renta de este inmueble.";
}

// ═══════════════════════════════════════════════════════════════════════
// 3. LO QUE DIJERON EN LAS VISITAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * `RealtyVisit.feedback` es texto libre (String? @db.Text): no hay enum ni
 * casillas. Para poder decirle al propietario "les pareció cara" hay que
 * leer lo que escribió el asesor, y eso es una HEURÍSTICA, no un dato duro.
 * Por eso la pantalla siempre enseña el texto original al lado del conteo:
 * el propietario juzga, nosotros solo agrupamos.
 *
 * Sin acentos en el patrón y comparando en minúsculas: el asesor escribe
 * desde el teléfono, entre visita y visita, y casi nunca acentúa.
 */
const PRICE_OBJECTION_PATTERNS: RegExp[] = [
  /\bcar[oa]s?\b/,
  /\bcarisim[oa]s?\b/,
  /\bprecio\s+(alto|elevado|arriba|excesivo|fuera)\b/,
  /\bmuy\s+(alto|elevado)\b/,
  /\bse\s+(pas[oa]|paso)\s+de\s+precio\b/,
  /\bfuera\s+de\s+(su\s+)?presupuesto\b/,
  /\bno\s+le\s+alcanz/,
  /\bno\s+alcanz/,
  /\bbajar\s+(el\s+)?precio\b/,
  /\bnegociar\s+(el\s+)?precio\b/,
  /\bpide\s+(un\s+)?descuento\b/,
  /\bmas\s+barat[oa]\b/,
];

/** Quita acentos y baja a minúsculas para que el patrón pegue igual. */
export function normalizeFeedback(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    // Rango de marcas diacríticas ESCAPADO. Con los caracteres crudos dentro
    // de la clase, cualquier editor que normalice el archivo se los come y el
    // reemplazo deja de funcionar sin que nadie lo note. Misma nota que la
    // ficha PDF de T1.
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * ¿Esta retroalimentación habla del PRECIO? Es lo que convierte "7 visitas y
 * ninguna oferta" en un consejo accionable en vez de en un lamento.
 */
export function looksLikePriceObjection(feedback: string | null | undefined): boolean {
  if (!feedback) return false;
  const s = normalizeFeedback(feedback);
  if (s.trim() === "") return false;
  for (const re of PRICE_OBJECTION_PATTERNS) {
    if (re.test(s)) return true;
  }
  return false;
}

/** ¿Le gustó el inmueble, dejando el precio aparte? También heurística. */
const LIKED_PATTERNS: RegExp[] = [
  /\ble\s+(gust|encant)/,
  /\bles\s+(gust|encant)/,
  /\bmuy\s+bonit/,
  /\bbien\s+ubicad/,
  /\binteresad/,
  /\bregres/,
  /\bvolver\s+a\s+ver/,
];

export function looksLikeLiked(feedback: string | null | undefined): boolean {
  if (!feedback) return false;
  const s = normalizeFeedback(feedback);
  for (const re of LIKED_PATTERNS) {
    if (re.test(s)) return true;
  }
  return false;
}

export function hasFeedback(feedback: string | null | undefined): boolean {
  return typeof feedback === "string" && feedback.trim() !== "";
}

// ═══════════════════════════════════════════════════════════════════════
// 4. FORMA DEL REPORTE AL PROPIETARIO
// ═══════════════════════════════════════════════════════════════════════

export interface OwnerReportPortalLine {
  /** Slug con el que se guarda en RealtyPortalListing.portal / RealtyLead.portal. */
  portal: string;
  label: string;
  /** ¿Está anunciado ahí AHORA? */
  published: boolean;
  status: string | null;
  lastPushedAt: string | null;
  /** Personas que escribieron desde ese portal en el periodo. */
  leads: number;
  /** De esas, cuántas llegaron a agendar visita. */
  visits: number;
  /** De esas, cuántas llegaron a etapa de oferta o más. */
  offers: number;
}

export interface OwnerReportVisitLine {
  id: string;
  scheduledAt: string;
  status: RealtyVisitStatus;
  /** Ya pasó su hora y no se canceló. Ver la nota de `visitHappened`. */
  happened: boolean;
  agentName: string | null;
  visitorName: string | null;
  feedback: string | null;
  priceObjection: boolean;
  liked: boolean;
}

export interface OwnerReportOfferLine {
  id: string;
  kind: "LEAD" | "DEAL";
  who: string;
  when: string | null;
  /** Solo los DEAL traen importe; una etapa OFERTA del CRM no guarda monto. */
  amountCents: number | null;
  currency: RealtyCurrency | null;
  status: string;
}

/** Lo que se está cerrando en la zona. Sale de operaciones REALES, no de un índice. */
export interface OwnerReportZone {
  city: string | null;
  colonia: string | null;
  kind: RealtyPropertyKind;
  currency: RealtyCurrency;
  /** Operaciones cerradas comparables que se encontraron. */
  closedCount: number;
  medianClosedCents: number;
  /** Precio de lista de ESTE inmueble contra la mediana de cierre. */
  deltaPct: number | null;
}

export type OwnerRecommendationTone =
  | "TEMPRANO"
  | "SIN_ANUNCIO"
  | "SIN_INTERES"
  | "SIN_VISITAS"
  | "PRECIO"
  | "SIN_OFERTAS"
  | "CON_OFERTAS"
  | "CERRADO";

export interface OwnerRecommendation {
  tone: OwnerRecommendationTone;
  /** Los hechos, en una línea. "7 visitas y ninguna oferta." */
  headline: string;
  /** La lectura: qué significan esos hechos. */
  body: string;
  /** Qué hacer. Frases cortas, cada una accionable. */
  actions: string[];
}

export interface OwnerReportResponse {
  answered: number;
  unanswered: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
}

export interface OwnerActivityReport {
  propertyId: string;
  propertyTitle: string;
  propertyKind: RealtyPropertyKind;
  address: string | null;
  ownerId: string | null;
  ownerName: string | null;
  currency: RealtyCurrency;
  askingPriceCents: number;
  operation: string;
  status: string;

  from: string;
  to: string;
  days: number;

  isPublished: boolean;
  webPublished: boolean;
  portals: OwnerReportPortalLine[];

  leads: number;
  calls: number;
  messages: number;
  response: OwnerReportResponse;

  visitsScheduled: number;
  visitsHappened: number;
  visitsCancelled: number;
  visitsNoShow: number;
  visits: OwnerReportVisitLine[];
  feedbackCount: number;
  priceObjections: number;
  likedCount: number;

  offers: OwnerReportOfferLine[];
  closedDeal: OwnerReportOfferLine | null;

  zone: OwnerReportZone | null;

  recommendation: OwnerRecommendation;
  generatedAt: string;
}

/**
 * ¿La visita OCURRIÓ?
 *
 * 🔴 No se puede preguntar `status === "REALIZADA"`: hoy NINGÚN código del
 * vertical marca ese estado (el único que mueve el status es la respuesta
 * del prospecto por WhatsApp, que solo pone CONFIRMADA o CANCELADA). Contar
 * por REALIZADA daría cero visitas siempre, y el reporte estrella diría que
 * a la casa no fue nadie.
 *
 * El criterio honesto es: ya pasó su hora y no se canceló ni faltó. Si algún
 * día alguien empieza a cerrar visitas, REALIZADA sigue contando igual.
 */
export function visitHappened(
  status: RealtyVisitStatus,
  scheduledAt: Date | string,
  now: Date,
): boolean {
  if (status === "REALIZADA") return true;
  if (status === "CANCELADA" || status === "NO_ASISTIO") return false;
  const when = typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  if (!when || Number.isNaN(when.getTime())) return false;
  return when.getTime() <= now.getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// 5. LA RECOMENDACIÓN EN TEXTO CLARO
// ═══════════════════════════════════════════════════════════════════════

export interface OwnerRecommendationInput {
  days: number;
  isPublished: boolean;
  portalsPublished: number;
  webPublished: boolean;
  leads: number;
  visitsHappened: number;
  visitsScheduled: number;
  feedbackCount: number;
  priceObjections: number;
  likedCount: number;
  offers: number;
  closed: boolean;
  response: OwnerReportResponse;
  zone: OwnerReportZone | null;
  operation: string;
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

function visitasTxt(n: number): string {
  return `${n} ${plural(n, "visita", "visitas")}`;
}

/**
 * Convierte los números del periodo en una lectura de negocio.
 *
 * El orden de los casos NO es cosmético: va del problema más arriba en el
 * embudo al más abajo. Si el inmueble ni siquiera está anunciado, hablar del
 * precio sería un consejo inútil; si nadie ha llamado, hablar de las visitas
 * también. Se diagnostica el primer escalón que está roto.
 */
export function buildOwnerRecommendation(
  input: OwnerRecommendationInput,
): OwnerRecommendation {
  const {
    days,
    isPublished,
    portalsPublished,
    webPublished,
    leads,
    visitsHappened,
    priceObjections,
    likedCount,
    offers,
    closed,
    response,
    zone,
  } = input;

  const anunciado = isPublished && (portalsPublished > 0 || webPublished);
  const zonaTxt = zoneSentence(zone);

  // ── 0. Ya se cerró: no hay nada que recomendar. ──
  if (closed) {
    return {
      tone: "CERRADO",
      headline: "La operación se cerró.",
      body:
        `Este inmueble ya tiene una operación cerrada en el periodo. ` +
        `En el camino hubo ${visitasTxt(visitsHappened)} y ${leads} ` +
        `${plural(leads, "persona interesada", "personas interesadas")}.`,
      actions: ["Cierra el expediente y pídele al propietario una recomendación."],
    };
  }

  // ── 1. No está anunciado: nadie puede verlo. ──
  if (!anunciado) {
    return {
      tone: "SIN_ANUNCIO",
      headline: "El inmueble no está anunciado.",
      body:
        "No aparece publicado en ningún portal ni en la web de la inmobiliaria, " +
        "así que nadie de fuera puede encontrarlo. Cualquier otro número de este " +
        "reporte va a salir en cero mientras eso siga así.",
      actions: [
        "Publícalo en la web y en los portales que tengas contratados.",
        "Revisa que tenga fotos: un anuncio sin fotos casi no se abre.",
      ],
    };
  }

  // ── 2. Muy pronto para juzgar. ──
  if (days < 14 && leads === 0) {
    return {
      tone: "TEMPRANO",
      headline: `Lleva ${days} ${plural(days, "día", "días")} publicado.`,
      body:
        "Todavía es pronto para sacar conclusiones. Un anuncio nuevo suele tardar " +
        "de dos a tres semanas en juntar sus primeros interesados.",
      actions: ["Vuelve a revisar este reporte en dos semanas."],
    };
  }

  // ── 3. Está anunciado y no llama nadie: el problema es el anuncio. ──
  if (leads === 0) {
    return {
      tone: "SIN_INTERES",
      headline: `${days} ${plural(days, "día", "días")} publicado y nadie ha preguntado.`,
      body:
        "El anuncio se está viendo pero no genera contactos. Cuando no llega ni " +
        "una sola pregunta, el problema casi nunca es el inmueble: es cómo se ve " +
        "el anuncio —la foto principal, el título y, sobre todo, el precio de " +
        `lista, que es lo primero que filtra la gente en un portal.${zonaTxt}`,
      actions: [
        "Cambia la foto de portada por la mejor que tengas.",
        "Revisa el precio de lista contra lo que se está pidiendo en la zona.",
      ],
    };
  }

  // ── 4. Preguntan pero no llegan a verla. ──
  if (visitsHappened === 0) {
    const lento =
      response.medianMinutes !== null && response.medianMinutes > 60
        ? ` Además, la primera respuesta está tardando ${describeMinutes(response.medianMinutes)}: ` +
          "pasados los primeros diez minutos, la probabilidad de contactar a un " +
          "interesado se desploma."
        : "";
    const sinContestar =
      response.unanswered > 0
        ? ` Hay ${response.unanswered} ${plural(response.unanswered, "persona que nunca recibió respuesta", "personas que nunca recibieron respuesta")}.`
        : "";
    return {
      tone: "SIN_VISITAS",
      headline: `${leads} ${plural(leads, "persona preguntó", "personas preguntaron")} y ninguna llegó a verla.`,
      body:
        "El anuncio sí funciona: la gente pregunta. Se están cayendo entre el " +
        `primer mensaje y la cita.${sinContestar}${lento}`,
      actions: [
        "Contesta el mismo día, aunque sea para agendar después.",
        "Ofrece dos horarios concretos en el primer mensaje en vez de preguntar cuándo pueden.",
      ],
    };
  }

  // ── 5. La vieron, les gustó, y les pareció cara. EL CASO. ──
  if (offers === 0 && priceObjections > 0) {
    const gusto =
      likedCount > 0
        ? "A los que la vieron les gustó, pero les pareció cara"
        : "Quienes la vieron coincidieron en que el precio está alto";
    return {
      tone: "PRECIO",
      headline: `${visitasTxt(visitsHappened)} y ninguna oferta.`,
      body:
        `${gusto}: de ${visitsHappened} ${plural(visitsHappened, "visita", "visitas")}, ` +
        `${priceObjections} ${plural(priceObjections, "mencionó", "mencionaron")} el precio. ` +
        `El precio está arriba de lo que se está cerrando en la zona.${zonaTxt}`,
      actions: [
        "Platica con el propietario un ajuste de precio.",
        "Enséñale este reporte: son sus visitas y sus comentarios, no una opinión.",
      ],
    };
  }

  // ── 6. La vieron y no pasó nada, sin que el precio salga en los comentarios. ──
  if (offers === 0) {
    const sinComentarios =
      input.feedbackCount === 0
        ? " Ninguna de esas visitas dejó comentario registrado, así que no sabemos " +
          "qué los detuvo: pedirle al asesor que anote qué dijeron al salir es lo " +
          "que convierte este reporte en algo accionable."
        : "";
    return {
      tone: "SIN_OFERTAS",
      headline: `${visitasTxt(visitsHappened)} y ninguna oferta.`,
      body:
        "El inmueble se está mostrando pero no cierra. Cuando el precio no aparece " +
        "en los comentarios, lo que suele frenar es el estado de conservación, la " +
        `distribución o algo del entorno que no se ve en las fotos.${sinComentarios}${zonaTxt}`,
      actions: [
        "Pídele al asesor que registre qué dijeron los que ya la vieron.",
        "Compárala contra las otras opciones que están viendo esos mismos interesados.",
      ],
    };
  }

  // ── 7. Hay ofertas. ──
  return {
    tone: "CON_OFERTAS",
    headline: `${offers} ${plural(offers, "oferta", "ofertas")} sobre la mesa.`,
    body:
      `Después de ${visitasTxt(visitsHappened)}, el inmueble tiene ` +
      `${offers} ${plural(offers, "interesado formal", "interesados formales")}. ` +
      `Es el momento de negociar.${zonaTxt}`,
    actions: [
      "Contesta las ofertas dentro de las siguientes 24 horas.",
      "Llévale al propietario todas las ofertas juntas para que decida con el panorama completo.",
    ],
  };
}

/** La frase de la zona, solo si hay comparables reales que la sostengan. */
function zoneSentence(zone: OwnerReportZone | null): string {
  if (!zone || zone.closedCount <= 0 || zone.deltaPct === null) return "";
  const donde = zone.colonia || zone.city;
  const lugar = donde ? ` en ${donde}` : "";
  const n = zone.closedCount;
  const base = ` Se ${plural(n, "cerró", "cerraron")} ${n} ${plural(n, "operación comparable", "operaciones comparables")}${lugar} con una mediana de ${formatCents(zone.medianClosedCents, zone.currency)}`;
  if (zone.deltaPct > 0) {
    return `${base}: este inmueble está pidiendo ${formatPctOrDash(zone.deltaPct)} por encima.`;
  }
  if (zone.deltaPct < 0) {
    return `${base}: este inmueble está pidiendo ${formatPctOrDash(Math.abs(zone.deltaPct))} por debajo.`;
  }
  return `${base}, prácticamente lo mismo que este inmueble.`;
}

function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} minutos`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} ${plural(h, "hora", "horas")}`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, "día", "días")}`;
}

/** Mediana entera de una lista. null si viene vacía. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/**
 * Cuánto está por encima (positivo) o por debajo (negativo) el precio de
 * lista respecto de la mediana de cierre de la zona, en por ciento.
 */
export function priceDeltaPct(
  askingCents: number,
  medianClosedCents: number,
): number | null {
  if (askingCents <= 0 || medianClosedCents <= 0) return null;
  return round1(((askingCents - medianClosedCents) * 100) / medianClosedCents);
}

// ═══════════════════════════════════════════════════════════════════════
// 6. HOJA DE CÁLCULO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Un CSV que Excel de Windows abre bien: BOM al principio (si no, los
 * acentos salen rotos) y comillas dobles escapadas duplicándolas.
 *
 * Va aquí, en el módulo puro, porque el propietario y el contador exportan
 * desde pantallas distintas y las dos tienen que escribir el mismo archivo.
 */
export const CSV_BOM = "﻿";

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  // El punto y coma y el salto de línea también obligan a entrecomillar, y
  // un valor que empieza con = lo interpreta Excel como fórmula.
  const needsQuotes = /[",;\n\r]/.test(s) || /^[=+\-@]/.test(s);
  const body = s.replace(/"/g, '""');
  return needsQuotes ? `"${body}"` : body;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvEscape).join(",");
}

export interface CsvSheetMeta {
  title: string;
  subtitle?: string | null;
  /** La moneda de la hoja. Va SIEMPRE: una columna de números sin moneda es
   *  una invitación a que alguien la sume con otra que no le toca. */
  currency?: RealtyCurrency | null;
  otherCurrencies?: readonly RealtyCurrency[];
  /** Renglones extra de encabezado: [etiqueta, valor]. */
  meta?: ReadonlyArray<readonly [string, unknown]>;
}

/**
 * Encabezado + tabla, en el mismo formato que `statementToCsv` de T4 para
 * que las dos exportaciones del vertical se vean iguales al abrirlas.
 */
export function buildCsvSheet(
  meta: CsvSheetMeta,
  header: readonly string[],
  rows: ReadonlyArray<readonly unknown[]>,
): string {
  const out: string[] = [];
  out.push(csvRow([meta.title]));
  if (meta.subtitle) out.push(csvRow([meta.subtitle]));
  if (meta.currency) out.push(csvRow(["Moneda", meta.currency]));
  if (meta.otherCurrencies && meta.otherCurrencies.length > 0) {
    out.push(
      csvRow([
        "Aviso",
        `Hay movimientos en ${meta.otherCurrencies.join(", ")} que NO están en esta hoja. ` +
          "No se sumaron con los de arriba porque serían un número sin significado.",
      ]),
    );
  }
  for (const [k, v] of meta.meta ?? []) out.push(csvRow([k, v]));
  out.push("");
  out.push(csvRow(header));
  for (const r of rows) out.push(csvRow(r));
  return CSV_BOM + out.join("\r\n") + "\r\n";
}

/** Nombre de archivo sin acentos ni espacios, que sobreviva a cualquier SO. */
export function safeFileName(base: string, ext: string): string {
  const clean = normalizeFeedback(base)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${clean || "reporte"}.${ext}`;
}

/**
 * Un bloque de la hoja: su título, su encabezado y sus renglones.
 *
 * Un reporte de verdad no cabe en UNA tabla. El del propietario lleva
 * portales, visitas y ofertas; el fiscal lleva inmuebles y pagos. Meterlos
 * en una sola rejilla obligaría a inventar columnas vacías, y quien abre el
 * archivo en Excel acabaría con una tabla que no puede ordenar.
 */
export interface CsvBlock {
  title?: string | null;
  header: readonly string[];
  rows: ReadonlyArray<readonly unknown[]>;
  /** Renglón de totales, al pie del bloque. */
  footer?: readonly unknown[] | null;
  /** Qué decir cuando el bloque no tiene ni un renglón. */
  emptyText?: string | null;
}

/**
 * Encabezado + N bloques separados por un renglón en blanco. Mismo BOM y
 * mismo escape que `buildCsvSheet`: las dos exportaciones del vertical se
 * abren igual.
 *
 * 🔴 Un bloque VACÍO no se omite: se pinta con su frase. Un archivo donde
 * "Visitas" simplemente no aparece se lee como "se me olvidó exportarlas";
 * uno que dice "no hubo visitas en el periodo" se lee como un dato.
 */
export function buildCsvReport(meta: CsvSheetMeta, blocks: readonly CsvBlock[]): string {
  const out: string[] = [];
  out.push(csvRow([meta.title]));
  if (meta.subtitle) out.push(csvRow([meta.subtitle]));
  if (meta.currency) out.push(csvRow(["Moneda", meta.currency]));
  if (meta.otherCurrencies && meta.otherCurrencies.length > 0) {
    out.push(
      csvRow([
        "Aviso",
        `Hay movimientos en ${meta.otherCurrencies.join(", ")} que NO están en esta hoja. ` +
          "No se sumaron con los de arriba porque serían un número sin significado.",
      ]),
    );
  }
  for (const [k, v] of meta.meta ?? []) out.push(csvRow([k, v]));

  for (const b of blocks) {
    out.push("");
    if (b.title) out.push(csvRow([b.title]));
    if (b.rows.length === 0) {
      out.push(csvRow([b.emptyText ?? "Sin movimientos en el periodo."]));
      continue;
    }
    out.push(csvRow(b.header));
    for (const r of b.rows) out.push(csvRow(r));
    if (b.footer) out.push(csvRow(b.footer));
  }

  return CSV_BOM + out.join("\r\n") + "\r\n";
}

/**
 * El importe listo para una celda de Excel: NÚMERO con punto decimal y sin
 * símbolo, porque una celda con "$12,000.00" es texto y no se puede sumar.
 * La moneda va en su propia columna, nunca pegada al número.
 */
export function csvAmount(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * Un total por moneda repartido en las dos columnas fijas (MXN y USD).
 *
 * 🔴 DOS COLUMNAS, NUNCA UNA. Es la misma regla de la pantalla llevada a la
 * hoja: si los pesos y los dólares compartieran columna, el primer
 * `=SUMA()` que alguien escriba en Excel produce el número inventado que
 * este módulo entero existe para evitar.
 */
export function csvMoneyCells(m: MoneyByCurrency): [string, string] {
  return [m.MXN === 0 ? "" : csvAmount(m.MXN), m.USD === 0 ? "" : csvAmount(m.USD)];
}

/** Los encabezados que acompañan a `csvMoneyCells`. */
export function csvMoneyHeaders(label: string): [string, string] {
  return [`${label} (MXN)`, `${label} (USD)`];
}

/** "2026-08-25" a partir de un ISO, para que Excel la lea como fecha. */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return String(iso).slice(0, 10);
}

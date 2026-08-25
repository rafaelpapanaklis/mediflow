// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — MOTOR DE MATCH prospecto ↔ inmueble.
//
// Módulo PURO a propósito: cero prisma, cero "server-only", cero acceso a
// red. Recibe dos objetos planos y devuelve un puntaje con el DESGLOSE de
// por qué. Lo consumen las tres partes:
//   · el servidor (src/lib/realty/leads.ts) para cruzar cartera ↔ embudo,
//   · las APIs de /api/realty/leads/matches,
//   · y los componentes "use client" que pintan "por qué hizo match"
//     (por eso no puede importar prisma: reventaría el bundle).
//
// LAS DOS DIRECCIONES son la MISMA función. No hay dos motores:
//   · Entra un inmueble  → se puntea contra N perfiles de búsqueda.
//   · Entra un prospecto → su perfil se puntea contra N inmuebles.
// Cambiar el orden del bucle no cambia el puntaje, y eso es justo lo que
// evita que "12 prospectos buscan esto" y "estos inmuebles le quedan" se
// contradigan en la misma pantalla.
//
// TOLERANCIA DEL PRESUPUESTO: ±10% por default y configurable. Nadie
// escribe su presupuesto real: quien dice "hasta 2 millones" firma en 2.15
// si la casa le gustó. Un match que corta EXACTO en el número tira
// justamente los prospectos que sí compran.
// ═══════════════════════════════════════════════════════════════════════
import type {
  RealtyCurrency,
  RealtyOperation,
  RealtyPropertyKind,
  RealtyPropertyStatus,
} from "@/lib/realty/types";

// ── Entradas ────────────────────────────────────────────────────────────

/** El inmueble, recortado a lo que el match necesita. */
export interface RealtyMatchProperty {
  id: string;
  title: string;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  /** Precio de VENTA. Siempre presente (default 0 en la BD). */
  price: number;
  /** Precio de RENTA mensual. null en un inmueble que solo se vende. */
  rentPrice: number | null;
  currency: RealtyCurrency;
  bedrooms: number | null;
  colonia: string | null;
  city: string | null;
  state: string | null;
}

/**
 * Quien BUSCA: el RealtySearchProfile del contacto, ya aplanado (kinds sale
 * del Json como lista de llaves en true), más lo que el propio prospecto
 * trae en el embudo.
 *
 * budgetMin/budgetMax se toman del perfil de búsqueda y, si ahí vienen
 * vacíos, del RealtyLead — que es donde el asesor los apunta primero.
 */
export interface RealtyMatchSeeker {
  contactId: string;
  /** null cuando el contacto tiene perfil de búsqueda pero ningún lead vivo. */
  leadId: string | null;
  name: string;
  operation: RealtyOperation;
  /** Tipos aceptados. Vacío = le da igual el tipo. */
  kinds: RealtyPropertyKind[];
  /** Colonias/ciudades que pidió, en texto libre. Vacío = cualquier zona. */
  zones: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  bedroomsMin: number | null;
  /** Del perfil de búsqueda. El envío lo hace T6; aquí solo se respeta. */
  notifyByWhatsapp: boolean;
}

// ── Salida ──────────────────────────────────────────────────────────────

export type RealtyMatchFactorKey =
  | "operacion"
  | "tipo"
  | "presupuesto"
  | "zona"
  | "recamaras";

/** Una razón del puntaje. `ok:false` con `points:0` también se pinta: el
 *  asesor necesita ver QUÉ falló, no solo el número. */
export interface RealtyMatchReason {
  key: RealtyMatchFactorKey;
  label: string;
  ok: boolean;
  points: number;
  maxPoints: number;
  /** Texto corto que explica el caso ("$2.15 M, 7% arriba de su tope"). */
  detail: string;
}

export interface RealtyMatchResult {
  /** 0-100. */
  score: number;
  /** ¿Pasa el umbral y ningún filtro duro? */
  matched: boolean;
  /** Motivo del descarte duro, si lo hubo. */
  blockedBy: "operacion" | "estatus" | null;
  reasons: RealtyMatchReason[];
}

// ── Parámetros ──────────────────────────────────────────────────────────

/** ±10%: nadie escribe su presupuesto real (ver cabecera). */
export const REALTY_MATCH_DEFAULT_TOLERANCE_PCT = 10;
/** Debajo de esto no se le enseña al asesor: sería ruido. */
export const REALTY_MATCH_MIN_SCORE = 60;

/** Pesos. Suman 100 y viven aquí para que la UI pinte la misma barra. */
export const REALTY_MATCH_WEIGHTS: Record<RealtyMatchFactorKey, number> = {
  operacion: 30,
  tipo: 20,
  presupuesto: 25,
  zona: 15,
  recamaras: 10,
};

export interface RealtyMatchOptions {
  /** Tolerancia del presupuesto en PORCENTAJE (10 = ±10%). */
  budgetTolerancePct?: number;
  /** Puntaje mínimo para considerar que hubo match. */
  minScore?: number;
  /**
   * Estatus del inmueble que SÍ se ofrecen. Default: solo DISPONIBLE.
   * Se puede abrir a APARTADO para "avísame si se cae el apartado".
   */
  allowedStatuses?: RealtyPropertyStatus[];
}

// ── Utilidades puras ────────────────────────────────────────────────────

/** Texto comparable: minúsculas, sin acentos, sin puntuación, sin dobles
 *  espacios. "Col. Américas" y "americas" tienen que cruzar. */
export function normalizeZoneText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    // Rango de diacríticos ESCAPADO (misma razón que makeRealtySlug: un
    // editor que normalice el archivo mutila la clase con caracteres crudos).
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palabras de relleno que no deben hacer match por sí solas: "col
 *  guadalupe" contra "col americas" cruzaría por "col". */
const ZONE_STOPWORDS = new Set([
  "col",
  "colonia",
  "fracc",
  "fraccionamiento",
  "residencial",
  "zona",
  "de",
  "la",
  "el",
  "los",
  "las",
  "del",
  "san",
  "santa",
]);

function zoneTokens(value: string | null | undefined): string[] {
  return normalizeZoneText(value)
    .split(" ")
    .filter((w) => w.length > 2 && !ZONE_STOPWORDS.has(w));
}

/**
 * ¿La zona pedida cruza con la ubicación del inmueble? Compara por
 * subcadena en las dos direcciones ("americas" ⊂ "las americas") y, si no,
 * por tokens significativos compartidos.
 */
export function zoneMatches(
  wanted: string,
  property: Pick<RealtyMatchProperty, "colonia" | "city" | "state">,
): boolean {
  const w = normalizeZoneText(wanted);
  if (!w) return false;
  const haystacks = [property.colonia, property.city, property.state]
    .map(normalizeZoneText)
    .filter(Boolean);
  if (haystacks.length === 0) return false;

  for (const h of haystacks) {
    if (h.includes(w) || w.includes(h)) return true;
  }
  const wTokens = new Set(zoneTokens(wanted));
  if (wTokens.size === 0) return false;
  for (const h of haystacks) {
    for (const token of zoneTokens(h)) {
      if (wTokens.has(token)) return true;
    }
  }
  return false;
}

/**
 * ¿Son compatibles la operación que busca y la que ofrece el inmueble?
 * AMBAS cruza con todo — de los dos lados.
 */
export function operationsCompatible(
  wanted: RealtyOperation,
  offered: RealtyOperation,
): boolean {
  if (wanted === "AMBAS" || offered === "AMBAS") return true;
  return wanted === offered;
}

/**
 * Precio que aplica según la operación que se está evaluando.
 * 🔴 Un inmueble AMBAS tiene los DOS precios: comparar la renta mensual
 * contra un presupuesto de compra descarta a todo el mundo (o al revés,
 * hace match de todos). Por eso el precio se elige por la operación del
 * QUE BUSCA, no por la del inmueble.
 */
export function priceForOperation(
  property: Pick<RealtyMatchProperty, "operation" | "price" | "rentPrice">,
  wanted: RealtyOperation,
): number | null {
  const wantsRent = wanted === "RENTA" || (wanted === "AMBAS" && property.operation === "RENTA");
  if (wantsRent) {
    if (property.rentPrice != null && property.rentPrice > 0) return property.rentPrice;
    // Un inmueble marcado RENTA sin rentPrice usa price como mensualidad.
    return property.operation === "RENTA" && property.price > 0 ? property.price : null;
  }
  return property.price > 0 ? property.price : null;
}

function money(n: number, currency: RealtyCurrency): string {
  const formatted = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
  return currency === "USD" ? `${formatted} USD` : formatted;
}

// ── El motor ────────────────────────────────────────────────────────────

/**
 * Puntúa un inmueble contra lo que busca un prospecto.
 *
 * FILTROS DUROS (devuelven score 0 y matched=false):
 *   · el inmueble no está en un estatus ofrecible (default: DISPONIBLE),
 *   · la operación no es compatible (quien busca renta no compra).
 *
 * TODO LO DEMÁS SUMA, no descarta: un prospecto sin zona escrita, sin
 * recámaras y sin presupuesto NO debe desaparecer del tablero — le faltan
 * datos, no interés. Un dato ausente se puntúa como "sin filtro" y suma
 * completo; lo que resta es un dato PRESENTE que no cuadra.
 */
export function scoreRealtyMatch(
  seeker: RealtyMatchSeeker,
  property: RealtyMatchProperty,
  options: RealtyMatchOptions = {},
): RealtyMatchResult {
  const tolerance = Math.max(0, options.budgetTolerancePct ?? REALTY_MATCH_DEFAULT_TOLERANCE_PCT) / 100;
  const minScore = options.minScore ?? REALTY_MATCH_MIN_SCORE;
  const allowed = options.allowedStatuses ?? (["DISPONIBLE"] as RealtyPropertyStatus[]);

  const reasons: RealtyMatchReason[] = [];
  const zero = (blockedBy: "operacion" | "estatus"): RealtyMatchResult => ({
    score: 0,
    matched: false,
    blockedBy,
    reasons,
  });

  // ── Filtro duro 1: estatus del inmueble ──
  if (!allowed.includes(property.status)) {
    reasons.push({
      key: "operacion",
      label: "Disponibilidad",
      ok: false,
      points: 0,
      maxPoints: 0,
      detail: "El inmueble ya no está disponible",
    });
    return zero("estatus");
  }

  // ── Filtro duro 2: operación ──
  const opOk = operationsCompatible(seeker.operation, property.operation);
  reasons.push({
    key: "operacion",
    label: "Operación",
    ok: opOk,
    points: opOk ? REALTY_MATCH_WEIGHTS.operacion : 0,
    maxPoints: REALTY_MATCH_WEIGHTS.operacion,
    detail: opOk
      ? seeker.operation === "AMBAS"
        ? "Le da igual comprar o rentar"
        : seeker.operation === "RENTA"
          ? "Busca renta y el inmueble se renta"
          : "Busca compra y el inmueble se vende"
      : seeker.operation === "RENTA"
        ? "Busca renta y este inmueble solo se vende"
        : "Busca compra y este inmueble solo se renta",
  });
  if (!opOk) return zero("operacion");

  let score = REALTY_MATCH_WEIGHTS.operacion;

  // ── Tipo de inmueble ──
  const kindOk = seeker.kinds.length === 0 || seeker.kinds.includes(property.kind);
  const kindPoints = kindOk ? REALTY_MATCH_WEIGHTS.tipo : 0;
  score += kindPoints;
  reasons.push({
    key: "tipo",
    label: "Tipo de inmueble",
    ok: kindOk,
    points: kindPoints,
    maxPoints: REALTY_MATCH_WEIGHTS.tipo,
    detail:
      seeker.kinds.length === 0
        ? "No pidió un tipo en particular"
        : kindOk
          ? "Es de los tipos que pidió"
          : "No es de los tipos que pidió",
  });

  // ── Presupuesto (con tolerancia) ──
  const price = priceForOperation(property, seeker.operation);
  const hasBudget = seeker.budgetMin != null || seeker.budgetMax != null;
  if (price == null) {
    // Sin precio capturado no se puede juzgar: se da el beneficio de la duda
    // a MEDIAS para que el inmueble no gane el tablero por estar incompleto.
    const half = Math.round(REALTY_MATCH_WEIGHTS.presupuesto / 2);
    score += half;
    reasons.push({
      key: "presupuesto",
      label: "Presupuesto",
      ok: false,
      points: half,
      maxPoints: REALTY_MATCH_WEIGHTS.presupuesto,
      detail: "El inmueble todavía no tiene precio capturado",
    });
  } else if (!hasBudget) {
    score += REALTY_MATCH_WEIGHTS.presupuesto;
    reasons.push({
      key: "presupuesto",
      label: "Presupuesto",
      ok: true,
      points: REALTY_MATCH_WEIGHTS.presupuesto,
      maxPoints: REALTY_MATCH_WEIGHTS.presupuesto,
      detail: "Todavía no dice cuánto quiere gastar",
    });
  } else {
    const max = seeker.budgetMax;
    const min = seeker.budgetMin;
    const maxWithTol = max != null ? max * (1 + tolerance) : null;
    const minWithTol = min != null ? min * (1 - tolerance) : null;

    const overExact = max != null && price > max;
    const overTol = maxWithTol != null && price > maxWithTol;
    const underExact = min != null && price < min;
    const underTol = minWithTol != null && price < minWithTol;

    let points: number;
    let ok: boolean;
    let detail: string;
    if (overTol || underTol) {
      points = 0;
      ok = false;
      const ref = overTol ? max! : min!;
      const pct = Math.round(Math.abs((price - ref) / ref) * 100);
      detail = overTol
        ? `${money(price, property.currency)} — ${pct}% arriba de su tope`
        : `${money(price, property.currency)} — ${pct}% abajo de lo que busca`;
    } else if (overExact || underExact) {
      // Dentro de la tolerancia pero fuera del número exacto: medio punto y
      // se DICE, para que el asesor sepa que va a tener que negociar.
      points = Math.round(REALTY_MATCH_WEIGHTS.presupuesto * 0.6);
      ok = true;
      const ref = overExact ? max! : min!;
      const pct = Math.round(Math.abs((price - ref) / ref) * 100);
      detail = overExact
        ? `${money(price, property.currency)} — ${pct}% arriba de su tope, dentro del margen`
        : `${money(price, property.currency)} — ${pct}% abajo, dentro del margen`;
    } else {
      points = REALTY_MATCH_WEIGHTS.presupuesto;
      ok = true;
      detail = `${money(price, property.currency)} — dentro de su presupuesto`;
    }
    score += points;
    reasons.push({
      key: "presupuesto",
      label: "Presupuesto",
      ok,
      points,
      maxPoints: REALTY_MATCH_WEIGHTS.presupuesto,
      detail,
    });
  }

  // ── Zona ──
  if (seeker.zones.length === 0) {
    score += REALTY_MATCH_WEIGHTS.zona;
    reasons.push({
      key: "zona",
      label: "Zona",
      ok: true,
      points: REALTY_MATCH_WEIGHTS.zona,
      maxPoints: REALTY_MATCH_WEIGHTS.zona,
      detail: "No pidió una zona en particular",
    });
  } else {
    const hit = seeker.zones.find((z) => zoneMatches(z, property));
    const points = hit ? REALTY_MATCH_WEIGHTS.zona : 0;
    score += points;
    reasons.push({
      key: "zona",
      label: "Zona",
      ok: Boolean(hit),
      points,
      maxPoints: REALTY_MATCH_WEIGHTS.zona,
      detail: hit
        ? `Buscaba en ${hit}`
        : `Buscaba en ${seeker.zones.slice(0, 3).join(", ")}`,
    });
  }

  // ── Recámaras ──
  if (seeker.bedroomsMin == null) {
    score += REALTY_MATCH_WEIGHTS.recamaras;
    reasons.push({
      key: "recamaras",
      label: "Recámaras",
      ok: true,
      points: REALTY_MATCH_WEIGHTS.recamaras,
      maxPoints: REALTY_MATCH_WEIGHTS.recamaras,
      detail: "No pidió un mínimo de recámaras",
    });
  } else if (property.bedrooms == null) {
    // Un terreno o una bodega no tienen recámaras: no se castiga.
    const neutral = property.kind === "TERRENO" || property.kind === "BODEGA" || property.kind === "LOCAL";
    const points = neutral ? REALTY_MATCH_WEIGHTS.recamaras : 0;
    score += points;
    reasons.push({
      key: "recamaras",
      label: "Recámaras",
      ok: neutral,
      points,
      maxPoints: REALTY_MATCH_WEIGHTS.recamaras,
      detail: neutral
        ? "No aplica para este tipo de inmueble"
        : "El inmueble no tiene capturadas las recámaras",
    });
  } else {
    const ok = property.bedrooms >= seeker.bedroomsMin;
    const points = ok ? REALTY_MATCH_WEIGHTS.recamaras : 0;
    score += points;
    reasons.push({
      key: "recamaras",
      label: "Recámaras",
      ok,
      points,
      maxPoints: REALTY_MATCH_WEIGHTS.recamaras,
      detail: ok
        ? `${property.bedrooms} recámaras (pedía ${seeker.bedroomsMin} o más)`
        : `${property.bedrooms} recámaras y pedía ${seeker.bedroomsMin} o más`,
    });
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: finalScore,
    matched: finalScore >= minScore,
    blockedBy: null,
    reasons,
  };
}

// ── Las dos direcciones (mismo motor, distinto bucle) ───────────────────

export interface RealtyPropertyMatchDTO {
  property: RealtyMatchProperty;
  score: number;
  reasons: RealtyMatchReason[];
}

export interface RealtySeekerMatchDTO {
  seeker: RealtyMatchSeeker;
  score: number;
  reasons: RealtyMatchReason[];
}

/**
 * Entra un PROSPECTO → qué inmuebles del inventario le quedan.
 * Ordenado por puntaje descendente; empate resuelto por precio ascendente
 * (a igual encaje, primero lo que le cuesta menos).
 */
export function matchPropertiesForSeeker(
  seeker: RealtyMatchSeeker,
  properties: RealtyMatchProperty[],
  options: RealtyMatchOptions = {},
): RealtyPropertyMatchDTO[] {
  const out: RealtyPropertyMatchDTO[] = [];
  for (const property of properties) {
    const r = scoreRealtyMatch(seeker, property, options);
    if (!r.matched) continue;
    out.push({ property, score: r.score, reasons: r.reasons });
  }
  return out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = priceForOperation(a.property, seeker.operation) ?? Number.MAX_SAFE_INTEGER;
    const pb = priceForOperation(b.property, seeker.operation) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

/**
 * Entra un INMUEBLE → qué prospectos lo están buscando ("12 prospectos
 * buscan esto"). Ordenado por puntaje descendente y, a empate, por nombre
 * para que la lista no baile entre recargas.
 */
export function matchSeekersForProperty(
  property: RealtyMatchProperty,
  seekers: RealtyMatchSeeker[],
  options: RealtyMatchOptions = {},
): RealtySeekerMatchDTO[] {
  const out: RealtySeekerMatchDTO[] = [];
  for (const seeker of seekers) {
    const r = scoreRealtyMatch(seeker, property, options);
    if (!r.matched) continue;
    out.push({ seeker, score: r.score, reasons: r.reasons });
  }
  return out.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.seeker.name.localeCompare(b.seeker.name, "es"),
  );
}

/** Etiqueta corta del puntaje para la píldora de la UI. */
export function matchScoreLabel(score: number): { label: string; tone: "success" | "brand" | "warning" } {
  if (score >= 90) return { label: "Encaje altísimo", tone: "success" };
  if (score >= 75) return { label: "Buen encaje", tone: "brand" };
  return { label: "Encaje parcial", tone: "warning" };
}

/**
 * Lee el Json `kinds` de RealtySearchProfile ({ CASA: true, TERRENO: false })
 * y devuelve la lista de tipos aceptados. Tolera que venga como arreglo
 * (["CASA"]) porque el editor del perfil puede guardar de las dos formas.
 */
export function readSearchProfileKinds(raw: unknown): RealtyPropertyKind[] {
  const VALID: RealtyPropertyKind[] = [
    "CASA",
    "DEPARTAMENTO",
    "TERRENO",
    "BODEGA",
    "LOCAL",
    "EDIFICIO",
    "OFICINA",
    "RANCHO",
  ];
  const valid = new Set<string>(VALID);
  if (Array.isArray(raw)) {
    return raw.filter((k): k is RealtyPropertyKind => typeof k === "string" && valid.has(k));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([k, v]) => valid.has(k) && v === true)
      .map(([k]) => k as RealtyPropertyKind);
  }
  return [];
}

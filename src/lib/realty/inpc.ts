// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — el aumento anual de la renta y el TOPE de la
// Ciudad de México. Módulo PURO y client-safe (sin prisma, sin
// "server-only"): la lectura del INPC desde `realty_calc_params` vive en
// src/lib/realty/leases.ts, que es el que habla con la base.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────
// La reforma al Código Civil de la Ciudad de México publicada en agosto de
// 2024 puso un techo al aumento anual de la renta de vivienda: no puede ser
// mayor que la inflación del año anterior. Un sistema de administración de
// rentas que deja capturar un 15 % sobre un inmueble en la CDMX no está
// siendo "flexible": está ayudando a redactar una cláusula que un juez
// puede tumbar, y el dueño se entera cuando ya firmó.
//
// Por eso el tope NO es un texto de ayuda. Es una reja:
//   1. Se calcula el aumento SUGERIDO con el INPC.
//   2. Si el inmueble está en la CDMX y el usuario captura un porcentaje
//      POR ENCIMA del tope, la pantalla avisa y NO deja guardar.
//   3. Solo se guarda si el usuario firma una confirmación explícita, y esa
//      confirmación QUEDA REGISTRADA (buildIncreaseAckLine) en las notas
//      del contrato, con fecha, quién y de cuánto era el tope.
//
// ── DEGRADACIÓN ────────────────────────────────────────────────────────
// El INPC lo carga otra terminal en `realty_calc_params`. Si todavía no
// está capturado, aquí NO se truena ni se inventa un número: se devuelve
// `inpcPct: null` y la pantalla pide el porcentaje a mano, diciendo por qué.
// Un dato inventado en una cláusula de aumento es peor que un dato ausente.
//
// 🔴 Nada de facturación: aquí se pacta una RENTA, no se timbra nada.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyIncreaseRule } from "@/lib/realty/types";
import { centsToNumber, toCents, type MoneyLike } from "@/lib/realty/rent-charges";

/** Referencia legal que se enseña junto al tope. Es lo que da la orden. */
export const REALTY_INCREASE_CAP_LAW =
  "Reforma al Código Civil de la Ciudad de México (agosto de 2024): el aumento anual " +
  "de la renta de vivienda no puede ser mayor que la inflación del año anterior.";

/** Etiqueta corta para las píldoras de la UI. */
export const REALTY_INCREASE_CAP_SHORT = "Tope de aumento en la CDMX";

// ── ¿El inmueble está en la Ciudad de México? ──────────────────────────
//
// `city` y `state` son texto libre en RealtyProperty: nadie captura igual.
// Se normaliza (sin acentos, mayúsculas, sin espacios de más) y se compara
// contra una lista CERRADA.
//
// 🔴 "MEXICO" a secas NO cuenta. En un campo de estado, "México" es el
// ESTADO DE MÉXICO — otra entidad, sin este tope. Marcar como CDMX un
// inmueble de Toluca bloquearía un aumento perfectamente legal, y el dueño
// nos odiaría con razón. Ante la duda, NO se aplica la reja.

const CDMX_MATCHES = new Set([
  "CDMX",
  "CMX",
  "DF",
  "D F",
  "DISTRITO FEDERAL",
  "CIUDAD DE MEXICO",
  "CIUDAD DE MEXICO CDMX",
  "MEXICO CITY",
  "CIUDAD MEXICO",
]);

/** Clave de estado que usa RealtyCalcParam para la CDMX. */
export const CDMX_STATE_CODE = "CMX";

/** Mayúsculas, sin acentos, sin puntuación y con un solo espacio. */
export function normalizePlace(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    // Rango de marcas diacríticas ESCAPADO a propósito: un editor que
    // normalice el archivo no puede mutilar ̀-ͯ.
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Este inmueble está en la Ciudad de México?
 *
 * Manda el ESTADO. La ciudad solo decide cuando el estado viene vacío: hay
 * capturas donde el estado está en blanco y la ciudad dice "Ciudad de
 * México". Al revés no: un inmueble con estado "JALISCO" y ciudad
 * "Ciudad de México" (un dedazo) no se marca como CDMX.
 */
export function isCdmxProperty(place: {
  city?: string | null;
  state?: string | null;
}): boolean {
  const state = normalizePlace(place?.state);
  if (state) return CDMX_MATCHES.has(state);
  return CDMX_MATCHES.has(normalizePlace(place?.city));
}

// ── El tope ────────────────────────────────────────────────────────────

/**
 * El tope de aumento: la inflación del año anterior, tal cual. Se expresa
 * en PORCENTAJE (4.21 = 4.21 %). null cuando no hay INPC capturado — la
 * pantalla lo dice y pide el dato, no adivina.
 */
export function annualIncreaseCapPct(inpcPct: number | null): number | null {
  if (inpcPct === null || inpcPct === undefined) return null;
  if (!Number.isFinite(inpcPct)) return null;
  // Un INPC negativo (deflación) sigue siendo el tope: si los precios
  // bajaron, la renta no puede subir. No se sube a 0 "por conveniencia".
  return round2(inpcPct);
}

/** ¿El porcentaje capturado se pasa del tope? Con margen de un centésimo. */
export function exceedsCap(pct: number, capPct: number | null): boolean {
  if (capPct === null || capPct === undefined) return false;
  if (!Number.isFinite(pct)) return false;
  return pct > capPct + 0.001;
}

/**
 * 🔴 ¿Este aumento necesita la confirmación explícita que queda registrada?
 *
 * Son DOS casos, y el segundo es el que se había quedado fuera:
 *
 *  1. Está en la CDMX y el porcentaje PASA el tope conocido.
 *  2. Está en la CDMX y NO SABEMOS cuál es el tope, porque el INPC todavía
 *     no está capturado (o la tabla no respondió).
 *
 * El caso 2 fallaba ABIERTO: sin tope conocido, `exceedsCap` devuelve false y
 * un +35 % en un departamento de la Roma se guardaba sin 409, sin
 * confirmación y sin una sola línea de huella. Eso contradice justo lo que
 * este módulo dice hacer — y el peor momento para no saber el tope es
 * precisamente cuando alguien está capturando un aumento grande.
 *
 * No saber el tope NO es lo mismo que no tener tope. Con el dato ausente se
 * pide la confirmación igual y se registra con `tope: sin dato`, que
 * buildIncreaseAckLine ya sabe escribir y parseIncreaseAcks ya sabe leer.
 *
 * Un aumento de 0 % o negativo nunca pide nada: no hay tope que rebasar.
 */
export function needsCapAck(args: {
  cdmx: boolean;
  pct: number;
  capPct: number | null;
}): boolean {
  if (!args.cdmx) return false;
  if (!Number.isFinite(args.pct) || args.pct <= 0) return false;
  if (args.capPct === null || args.capPct === undefined) return true; // no lo sabemos
  return exceedsCap(args.pct, args.capPct);
}

/** Redondeo a dos decimales para PRESENTAR. Nunca se usa a media cuenta. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
}

/** "4.21 %" en es-MX. Un guion largo cuando no hay dato. */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  try {
    return `${new Intl.NumberFormat("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(pct)} %`;
  } catch {
    return `${round2(pct)} %`;
  }
}

// ── El cálculo del aumento ─────────────────────────────────────────────

export interface IncreaseSuggestion {
  /** La regla pactada en el contrato. */
  rule: RealtyIncreaseRule;
  /** Inflación del año anterior en %, o null si no está capturada. */
  inpcPct: number | null;
  /** Año del INPC que se usó. null si no hubo dato. */
  inpcYear: number | null;
  /** El tope legal aplicable, o null si no aplica / no hay dato. */
  capPct: number | null;
  /** ¿El inmueble está en la CDMX? (el tope solo aplica ahí). */
  cdmx: boolean;
  /** El porcentaje SUGERIDO por el sistema. null = hay que capturarlo. */
  suggestedPct: number | null;
  /** Renta actual en centavos. */
  currentRentCents: number;
  /** Renta que quedaría con el porcentaje sugerido. null si no hay sugerencia. */
  suggestedRentCents: number | null;
  /** Por qué no hay sugerencia (para que la pantalla lo diga con palabras). */
  missing: "NINGUNO" | "INPC_SIN_CAPTURAR" | "PCT_SIN_PACTAR" | null;
}

export interface SuggestIncreaseArgs {
  rule: RealtyIncreaseRule;
  /** increasePct del contrato, cuando la regla es FIJO. */
  fixedPct: number | null;
  /** Inflación del año anterior en %, leída de realty_calc_params. */
  inpcPct: number | null;
  inpcYear: number | null;
  currentRent: MoneyLike;
  cdmx: boolean;
}

/**
 * El aumento que el sistema propone. NO decide por el usuario: propone,
 * enseña el tope y deja el número editable. Lo que sí hace es no dejar
 * pasar en silencio un porcentaje por encima del tope de la CDMX.
 */
export function suggestIncrease(args: SuggestIncreaseArgs): IncreaseSuggestion {
  const currentRentCents = toCents(args.currentRent);
  const capPct = args.cdmx ? annualIncreaseCapPct(args.inpcPct) : null;

  let suggestedPct: number | null = null;
  let missing: IncreaseSuggestion["missing"] = null;

  if (args.rule === "NINGUNO") {
    suggestedPct = 0;
    missing = "NINGUNO";
  } else if (args.rule === "INPC") {
    if (args.inpcPct === null || args.inpcPct === undefined) {
      missing = "INPC_SIN_CAPTURAR";
    } else {
      suggestedPct = round2(args.inpcPct);
    }
  } else {
    // FIJO
    if (args.fixedPct === null || args.fixedPct === undefined) {
      missing = "PCT_SIN_PACTAR";
    } else {
      suggestedPct = round2(args.fixedPct);
      // Un fijo pactado por encima del tope se sugiere YA RECORTADO: el
      // sistema propone lo legal. El usuario puede subirlo a mano, pero
      // entonces tiene que firmar la confirmación.
      if (capPct !== null && exceedsCap(suggestedPct, capPct)) suggestedPct = capPct;
    }
  }

  return {
    rule: args.rule,
    inpcPct: args.inpcPct ?? null,
    inpcYear: args.inpcYear ?? null,
    capPct,
    cdmx: args.cdmx,
    suggestedPct,
    currentRentCents,
    suggestedRentCents:
      suggestedPct === null ? null : applyIncreaseToCents(currentRentCents, suggestedPct),
    missing,
  };
}

/**
 * Aplica un porcentaje a una renta EN CENTAVOS y devuelve centavos enteros.
 *
 * El redondeo va al final y al centavo (medio hacia arriba): 12 000.00 con
 * 4.21 % son 12 505.20, no 12 505.199999999999. Nunca se redondea a media
 * cuenta ni se trabaja el importe en pesos con decimales flotantes.
 */
export function applyIncreaseToCents(rentCents: number, pct: number): number {
  if (!Number.isFinite(pct)) return rentCents;
  const factor = 1 + pct / 100;
  const raw = rentCents * factor;
  return Math.round(raw + (raw >= 0 ? 1e-6 : -1e-6));
}

/** Igual que applyIncreaseToCents pero de importe a importe (para la UI). */
export function applyIncrease(rent: MoneyLike, pct: number): number {
  return centsToNumber(applyIncreaseToCents(toCents(rent), pct));
}

// ── La confirmación explícita que QUEDA REGISTRADA ─────────────────────
//
// RealtyLease no tiene columna para esto (el schema es de la Ola 0 y no se
// toca), pero sí tiene `notes` (Text). Se usa una LÍNEA MARCADA con un
// prefijo reservado, igual que barber marca las cancelaciones suaves en su
// `notes`. La línea es legible por una persona Y parseable por el código:
// la pantalla de aumentos la vuelve a leer para enseñar el historial.
//
// Formato (una sola línea, sin saltos):
//   [aumento-tope-cdmx] 2026-08-25 | usuario: <id> | tope: 4.21% | aplicado: 9.00% | motivo: <texto>
//
// 🔴 Estas líneas NO se borran ni se editan al guardar otras notas: son la
// evidencia de que alguien fue advertido y decidió seguir. Quien escriba
// sobre `notes` conserva las líneas marcadas (ver mergeNotesPreservingAcks).

export const INCREASE_ACK_PREFIX = "[aumento-tope-cdmx]";

export interface IncreaseAck {
  /** "YYYY-MM-DD" de cuando se firmó. */
  date: string;
  userId: string;
  capPct: number | null;
  appliedPct: number;
  reason: string;
}

/** Arma la línea marcada que se agrega a RealtyLease.notes. */
export function buildIncreaseAckLine(args: {
  date: string;
  userId: string;
  capPct: number | null;
  appliedPct: number;
  reason: string;
}): string {
  // Se aplasta cualquier salto de línea: la marca ocupa UNA línea o el
  // parser de abajo se confunde con la nota que el usuario escriba después.
  const reason = String(args.reason ?? "")
    .replace(/[\r\n|]+/g, " ")
    .trim()
    .slice(0, 300);
  const cap = args.capPct === null ? "sin dato" : `${round2(args.capPct)}%`;
  return (
    `${INCREASE_ACK_PREFIX} ${args.date} | usuario: ${args.userId} | tope: ${cap} | ` +
    `aplicado: ${round2(args.appliedPct)}% | motivo: ${reason || "sin motivo capturado"}`
  );
}

/** Lee del texto de `notes` todas las confirmaciones registradas. */
export function parseIncreaseAcks(notes: string | null | undefined): IncreaseAck[] {
  if (!notes) return [];
  const out: IncreaseAck[] = [];
  for (const line of String(notes).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(INCREASE_ACK_PREFIX)) continue;
    const body = trimmed.slice(INCREASE_ACK_PREFIX.length).trim();
    const date = (/^(\d{4}-\d{2}-\d{2})/.exec(body) || [])[1] ?? "";
    const userId = (/usuario:\s*([^|]+)/.exec(body) || [])[1]?.trim() ?? "";
    const capRaw = (/tope:\s*([^|]+)/.exec(body) || [])[1]?.trim() ?? "";
    const appliedRaw = (/aplicado:\s*([^|]+)/.exec(body) || [])[1]?.trim() ?? "";
    const reason = (/motivo:\s*([\s\S]*)$/.exec(body) || [])[1]?.trim() ?? "";
    const capPct = capRaw === "sin dato" ? null : parseFloat(capRaw);
    const appliedPct = parseFloat(appliedRaw);
    out.push({
      date,
      userId,
      capPct: capPct !== null && Number.isFinite(capPct) ? capPct : null,
      appliedPct: Number.isFinite(appliedPct) ? appliedPct : 0,
      reason,
    });
  }
  return out;
}

/** Las líneas marcadas que hay dentro de un texto de notas. */
export function extractAckLines(notes: string | null | undefined): string[] {
  if (!notes) return [];
  return String(notes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith(INCREASE_ACK_PREFIX));
}

/** El texto de notas SIN las líneas marcadas (lo que el usuario edita). */
export function stripAckLines(notes: string | null | undefined): string {
  if (!notes) return "";
  return String(notes)
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith(INCREASE_ACK_PREFIX))
    .join("\n")
    .trim();
}

/**
 * Guarda las notas del usuario SIN perder las confirmaciones registradas.
 * Quien edita las notas del contrato desde la pantalla nunca ve estas
 * líneas en el cuadro de texto, y aun así no las puede borrar.
 */
export function mergeNotesPreservingAcks(
  previousNotes: string | null | undefined,
  userNotes: string | null | undefined,
  extraAckLines: string[] = [],
): string | null {
  const acks = extractAckLines(previousNotes).concat(extraAckLines.filter(Boolean));
  const clean = stripAckLines(userNotes);
  const parts: string[] = [];
  if (clean) parts.push(clean);
  if (acks.length > 0) parts.push(acks.join("\n"));
  const joined = parts.join("\n\n").trim();
  return joined ? joined : null;
}

// ── El aviso de aumento para el inquilino ──────────────────────────────

/**
 * El texto del aviso de aumento. Va por escrito porque un aumento se avisa
 * con anticipación y por escrito; el dueño lo copia, lo manda por WhatsApp
 * (T6) o lo imprime.
 */
export function buildIncreaseNotice(args: {
  tenantName: string;
  propertyTitle: string;
  landlordName: string;
  currentRentLabel: string;
  newRentLabel: string;
  pct: number;
  effectiveFromLabel: string;
  cdmx: boolean;
  capPct: number | null;
  inpcYear: number | null;
}): string {
  const nombre = (args.tenantName || "").trim() || "Estimado inquilino";
  const base =
    `${nombre}:\n\n` +
    `Le informamos que, conforme a lo pactado en el contrato de arrendamiento de ` +
    `${args.propertyTitle || "el inmueble"}, a partir del ${args.effectiveFromLabel} la renta ` +
    `mensual pasa de ${args.currentRentLabel} a ${args.newRentLabel}, ` +
    `un incremento de ${formatPct(args.pct)}.\n\n`;

  const legal =
    args.cdmx && args.capPct !== null
      ? `Este incremento no rebasa la inflación del año ${args.inpcYear ?? "anterior"} ` +
        `(${formatPct(args.capPct)}), que es el máximo permitido para inmuebles en la ` +
        `Ciudad de México.\n\n`
      : "";

  return (
    base +
    legal +
    `El día de pago y la forma de pago no cambian. Quedamos a sus órdenes para cualquier ` +
    `aclaración.\n\nAtentamente,\n${args.landlordName}`
  );
}

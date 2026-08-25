/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — ARITMÉTICA del reparto de comisiones.
 *
 * Módulo PURO y CLIENT-SAFE a propósito (sin prisma, sin "server-only"): el
 * editor de reparto necesita enseñar los pesos MIENTRAS se escribe, y el
 * servidor tiene que validar EXACTAMENTE lo mismo antes de guardar. Si la
 * pantalla calculara por su cuenta y la API por la suya, tarde o temprano
 * una guardaría un reparto que la otra considera inválido.
 *
 * 🔴 CENTAVOS ENTEROS Y BigInt, NUNCA float.
 * `commissionAmount` es Decimal(14,2) en la base: hasta 999 999 999 999.99,
 * o sea ~1e14 centavos. Multiplicar eso por 10 000 (los puntos base del
 * porcentaje) da ~1e18 y REVIENTA el entero seguro de JavaScript (9e15), sin
 * avisar y con el resultado equivocado. Por eso el producto va en BigInt y
 * solo se vuelve Number cuando ya es un importe.
 *
 * REPARTO EXACTO (método del resto mayor / Hamilton): 33.33% de $100 tres
 * veces da 33.33 + 33.33 + 33.33 = 99.99 y falta un centavo. Repartir "a
 * ojo" deja un centavo colgando que nadie cobra y que no cuadra con el
 * recibo. Aquí el residuo se entrega, centavo a centavo, a las partes con la
 * fracción más grande: la suma de las partes SIEMPRE es igual a la comisión.
 *
 * CONTEXTO DE MERCADO (México, para las ayudas de la pantalla — no son
 * reglas duras, nadie queda bloqueado por salirse):
 *   · Comisión típica de venta: 3% a 8%; lo normal 4% a 7%.
 *   · En franquicia: 3% a 4.5%, con una parte para la franquicia.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type {
  RealtyCommissionParty,
  RealtyDealKind,
  RealtyDealStatus,
} from "@/lib/realty/types";
import { REALTY_COMMISSION_PARTY_LABELS } from "@/lib/realty/types";

// ── Dinero en centavos ─────────────────────────────────────────────────

/** Lo que puede llegar como importe: Prisma.Decimal entra por su toString. */
export type MoneyLike = number | string | { toString(): string } | null | undefined;

/**
 * Importe → centavos ENTEROS. Trabaja sobre el TEXTO del número para no
 * heredar el error binario de `Math.round(x * 100)` (1.005 → 100 en vez de
 * 101). Basura → 0, igual que el `Number(x) || 0` que sustituye.
 */
export function toCents(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const raw = typeof value === "string" ? value : String(value);
  const s = raw.trim().replace(/[\s,$]/g, "");
  if (!s) return 0;

  let cents: number;
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) {
    // Notación científica u otra forma rara: mejor un redondeo que un NaN.
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    cents = Math.round(n * 100);
  } else {
    const sign = m[1] ? -1 : 1;
    const int = m[2] || "0";
    const frac = (m[3] || "").padEnd(3, "0").slice(0, 3);
    // El tercer decimal se usa SOLO para redondear el segundo (0.005 → 0.01).
    // Se CORTA en el tercero (no se redondea antes): redondear dos veces
    // convertiría "1.234999" en $1.24 cuando son $1.23.
    // El signo se aplica AL FINAL, sobre la magnitud ya redondeada, para que
    // toCents(-x) === -toCents(x). Sin esa simetría, sumar los mismos
    // importes en distinto orden podía dar un centavo de diferencia.
    const base = Number(int) * 100 + Number(frac.slice(0, 2));
    const third = Number(frac[2]);
    cents = sign * (base + (third >= 5 ? 1 : 0));
  }

  // 🔴 UNA sola puerta de salida, y guarda contra el infinito.
  // "1e307" pasa el Number.isFinite de arriba, pero ×100 se desborda a
  // Infinity — y más adelante BigInt(Infinity) LANZA un RangeError, con lo
  // que computeSplits rompía su promesa de "nunca lanza": tumbaba el editor
  // de reparto en pleno render y devolvía un 500 en vez de un 400.
  // Fuera del entero seguro tampoco hay importe real que valga: el techo del
  // schema es Decimal(14,2), unos 1e14 centavos.
  if (!Number.isSafeInteger(cents)) return 0;
  // -0 existe en JS y formatMoney(-0) imprime "-$0.00".
  return cents || 0;
}

/** Centavos enteros → pesos con dos decimales exactos. */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** Suma exacta de importes: enteros de centavos, un solo redondeo al final. */
export function sumMoney(values: readonly MoneyLike[]): number {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return centsToAmount(cents);
}

/** sumMoney sobre una propiedad: `sumMoneyBy(splits, (s) => s.amount)`. */
export function sumMoneyBy<T>(items: readonly T[], pick: (item: T) => MoneyLike): number {
  let cents = 0;
  for (const it of items) cents += toCents(pick(it));
  return centsToAmount(cents);
}

/** Importe en pesos mexicanos, formato es-MX. */
export function formatMoney(amount: MoneyLike, currency: string = "MXN"): string {
  const n = centsToAmount(toCents(amount));
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)} ${currency}`;
  }
}

/**
 * Porcentaje con dos decimales, sin ceros de relleno ("40%", "33.33%").
 *
 * 🔴 NO pasa por pctToBps: ese recorta a 100 porque valida lo que se TECLEA
 * en una fila. Aquí solo se PINTA, y recortar era mentir justo cuando más
 * importa: un reparto al 150% se enseñaba como "100%" mientras el chip de
 * dinero decía "sobran $500". Dos números contradictorios en la misma línea.
 */
export function formatPct(pct: number): string {
  const n = Number.isFinite(pct) ? pct : 0;
  const s = n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${s}%`;
}

// ── Porcentajes en puntos base ─────────────────────────────────────────
// `pct` es Decimal(5,2) en la base: 100.00 como máximo, dos decimales. En
// puntos base (centésimas de punto) es un entero: 40.00% → 4000, 100% →
// 10000. Comparar enteros evita el clásico 0.1 + 0.2 !== 0.3.

export const PCT_TOTAL_BPS = 10_000;

/** 40.5 → 4050. Basura → 0. Recorta a [0, 10000]. */
export function pctToBps(pct: MoneyLike): number {
  const bps = toCents(pct); // misma conversión: dos decimales → entero
  if (!Number.isFinite(bps)) return 0;
  return Math.min(Math.max(bps, 0), PCT_TOTAL_BPS);
}

/** 4050 → 40.5 */
export function bpsToPct(bps: number): number {
  return Math.round(bps) / 100;
}

// ── El reparto ─────────────────────────────────────────────────────────

/** Cómo se capturó una parte: por porcentaje o por monto fijo. */
export type RealtySplitMode = "PCT" | "AMOUNT";

/** Una parte del reparto, tal como la captura la pantalla. */
export interface RealtySplitInput {
  /** Llave estable de la fila en la UI (no se guarda). */
  key?: string;
  party: RealtyCommissionParty;
  /** Usuario de la cuenta que cobra. null = oficina, franquicia o externo. */
  realtyUserId?: string | null;
  /** Nombre de la contraparte cuando no hay usuario. */
  externalName?: string | null;
  mode: RealtySplitMode;
  /** Porcentaje 0–100 (se usa si mode = "PCT"). */
  pct?: MoneyLike;
  /** Monto en pesos (se usa si mode = "AMOUNT"). */
  amount?: MoneyLike;
}

/** Una parte ya calculada: pesos y porcentaje que SIEMPRE cuadran. */
export interface RealtySplitComputed {
  key: string;
  party: RealtyCommissionParty;
  realtyUserId: string | null;
  externalName: string | null;
  mode: RealtySplitMode;
  /** Porcentaje efectivo sobre la comisión (2 decimales). */
  pct: number;
  /** Importe en pesos (2 decimales). */
  amount: number;
  /** El mismo importe en centavos enteros — es el que suma. */
  amountCents: number;
}

export type RealtySplitProblemCode =
  | "SIN_COMISION"
  | "SIN_PARTES"
  | "PCT_FUERA_DE_RANGO"
  | "MONTO_NEGATIVO"
  | "FALTA_NOMBRE_EXTERNO"
  | "USUARIO_EN_PARTE_DE_CASA"
  | "NO_CIERRA";

export interface RealtySplitProblem {
  code: RealtySplitProblemCode;
  message: string;
  /** Índice de la fila con el problema, o null si es del reparto entero. */
  index: number | null;
}

export interface RealtySplitResult {
  rows: RealtySplitComputed[];
  /** Comisión a repartir, en centavos. */
  commissionCents: number;
  /** Suma de las partes, en centavos. */
  assignedCents: number;
  /** commissionCents - assignedCents. 0 = cierra. Puede ser negativo. */
  differenceCents: number;
  /** El mismo faltante/sobrante en pesos, que es lo que se le enseña a la gente. */
  difference: number;
  /** Suma de los porcentajes efectivos, en puntos base. 10000 = 100%. */
  totalBps: number;
  /** ¿Se puede guardar? */
  valid: boolean;
  problems: RealtySplitProblem[];
}

/** Las partes que son de la CASA: no tienen persona detrás. */
const HOUSE_PARTIES: RealtyCommissionParty[] = ["OFICINA", "FRANQUICIA"];

export function isHouseParty(party: RealtyCommissionParty): boolean {
  return HOUSE_PARTIES.includes(party);
}

/**
 * Reparte `commission` entre `inputs` y dice si el reparto CIERRA.
 *
 * Reglas:
 *  · Las partes por MONTO se toman tal cual (en centavos).
 *  · Las partes por PORCENTAJE se calculan sobre la comisión COMPLETA, no
 *    sobre lo que sobra. Un 40% es 40% del total: si alguien captura montos
 *    fijos que no dejan espacio, el reparto NO cierra y se dice cuánto falta.
 *  · El residuo de la división entera se reparte por resto mayor entre las
 *    partes de porcentaje, así que la suma es EXACTA.
 *  · Cierra cuando la suma de las partes es igual a la comisión, al centavo.
 *
 * Nunca lanza: devuelve `valid: false` con los problemas explicados. La UI
 * los pinta y la API los devuelve como 400 con el mismo texto.
 */
export function computeSplits(
  commission: MoneyLike,
  inputs: readonly RealtySplitInput[],
): RealtySplitResult {
  const commissionCents = Math.max(0, toCents(commission));
  const problems: RealtySplitProblem[] = [];

  if (commissionCents <= 0) {
    problems.push({
      code: "SIN_COMISION",
      message: "Captura primero cuánto se cobró de comisión.",
      index: null,
    });
  }
  if (inputs.length === 0) {
    problems.push({
      code: "SIN_PARTES",
      message: "Agrega al menos a quién le toca la comisión.",
      index: null,
    });
  }

  // 1) Normalizar cada fila y validar lo suyo.
  interface Prepared {
    input: RealtySplitInput;
    index: number;
    party: RealtyCommissionParty;
    realtyUserId: string | null;
    externalName: string | null;
    mode: RealtySplitMode;
    bps: number;
    fixedCents: number;
  }

  const prepared: Prepared[] = inputs.map((input, index) => {
    const party = input.party;
    const house = isHouseParty(party);
    const realtyUserId = house ? null : (input.realtyUserId || null);
    const externalName =
      typeof input.externalName === "string" ? input.externalName.trim() : "";

    if (house && input.realtyUserId) {
      problems.push({
        code: "USUARIO_EN_PARTE_DE_CASA",
        message: `La parte de ${REALTY_COMMISSION_PARTY_LABELS[party].toLowerCase()} no se le asigna a una persona.`,
        index,
      });
    }
    // Una fila sin usuario y sin nombre pinta un monto anónimo en el recibo.
    if (!house && !realtyUserId && !externalName) {
      problems.push({
        code: "FALTA_NOMBRE_EXTERNO",
        message: "Escribe de quién es esta parte (o elige a alguien de tu equipo).",
        index,
      });
    }

    const mode: RealtySplitMode = input.mode === "AMOUNT" ? "AMOUNT" : "PCT";
    let bps = 0;
    let fixedCents = 0;

    if (mode === "PCT") {
      const rawBps = toCents(input.pct);
      if (rawBps < 0 || rawBps > PCT_TOTAL_BPS) {
        problems.push({
          code: "PCT_FUERA_DE_RANGO",
          message: "El porcentaje va entre 0 y 100.",
          index,
        });
      }
      bps = Math.min(Math.max(rawBps, 0), PCT_TOTAL_BPS);
    } else {
      const raw = toCents(input.amount);
      if (raw < 0) {
        problems.push({
          code: "MONTO_NEGATIVO",
          message: "El monto no puede ser negativo.",
          index,
        });
      }
      fixedCents = Math.max(0, raw);
    }

    return {
      input,
      index,
      party,
      realtyUserId,
      externalName: externalName || null,
      mode,
      bps,
      fixedCents,
    };
  });

  // 2) Porcentajes → centavos por resto mayor. El producto va en BigInt: con
  //    Number, una comisión grande por 10 000 se sale del entero seguro.
  const pctRows = prepared.filter((p) => p.mode === "PCT");
  const centsByIndex = new Map<number, number>();

  const bigCommission = BigInt(commissionCents);
  const bigTotal = BigInt(PCT_TOTAL_BPS);
  const remainders: { index: number; rem: bigint; bps: number }[] = [];
  let distributed = 0;

  for (const row of pctRows) {
    const numerator = bigCommission * BigInt(row.bps);
    const floor = numerator / bigTotal;
    const rem = numerator % bigTotal;
    const floorNum = Number(floor);
    centsByIndex.set(row.index, floorNum);
    distributed += floorNum;
    remainders.push({ index: row.index, rem, bps: row.bps });
  }

  // Cuánto se debía repartir por porcentaje en total (redondeando el
  // conjunto, no cada parte): esa es la meta que el resto mayor persigue.
  const totalPctBps = pctRows.reduce((acc, r) => acc + r.bps, 0);
  const targetPctCents = Number((bigCommission * BigInt(totalPctBps)) / bigTotal);
  let leftover = targetPctCents - distributed;

  if (leftover > 0 && remainders.length > 0) {
    // Resto más grande primero; a igualdad, el porcentaje mayor; a igualdad,
    // el orden de captura. Determinista: el mismo reparto da lo mismo hoy y
    // dentro de un año.
    remainders.sort((a, b) => {
      if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
      if (a.bps !== b.bps) return b.bps - a.bps;
      return a.index - b.index;
    });
    for (let i = 0; leftover > 0 && i < remainders.length; i++, leftover--) {
      const idx = remainders[i].index;
      centsByIndex.set(idx, (centsByIndex.get(idx) ?? 0) + 1);
    }
  }

  for (const row of prepared) {
    if (row.mode === "AMOUNT") centsByIndex.set(row.index, row.fixedCents);
  }

  // 3) El porcentaje que se PINTA sale del importe final de cada parte, y se
  //    reparte con el MISMO resto mayor que el dinero.
  //
  //    🔴 Antes se derivaba con una división entera de BigInt, que trunca
  //    hacia abajo: tres partes por MONTO de $1.00 sobre una comisión de
  //    $3.00 daban 33.33% cada una, y la barra decía "99.99%" JUNTO AL
  //    PALOMEO VERDE de "cierra al 100%". Dos números contradiciéndose en la
  //    misma línea. Y peor: ese 33.33 truncado se guardaba en la base, con lo
  //    que inferTemplates descartaba el reparto por no sumar 100 — una
  //    operación cerrada al centavo no llegaba nunca a ser plantilla de la
  //    cuenta y nadie iba a saber por qué.
  //
  //    Derivarlo del IMPORTE y no de lo tecleado tiene otra virtud: cuando el
  //    reparto cierra, los porcentajes suman 100 por construcción.
  const bpsByIndex = new Map<number, number>();
  if (commissionCents > 0) {
    const bpsRemainders: { index: number; rem: bigint; cents: number }[] = [];
    let bpsFloorSum = 0;
    let assignedSoFar = 0;
    for (const p of prepared) {
      const cents = centsByIndex.get(p.index) ?? 0;
      assignedSoFar += cents;
      const numerator = BigInt(cents) * bigTotal;
      const floor = Number(numerator / bigCommission);
      bpsByIndex.set(p.index, floor);
      bpsFloorSum += floor;
      bpsRemainders.push({ index: p.index, rem: numerator % bigCommission, cents });
    }
    const bpsTarget = Number((BigInt(assignedSoFar) * bigTotal) / bigCommission);
    let bpsLeft = bpsTarget - bpsFloorSum;
    if (bpsLeft > 0) {
      bpsRemainders.sort((a, b) => {
        if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
        if (a.cents !== b.cents) return b.cents - a.cents;
        return a.index - b.index;
      });
      for (let i = 0; bpsLeft > 0 && i < bpsRemainders.length; i++, bpsLeft--) {
        const idx = bpsRemainders[i].index;
        bpsByIndex.set(idx, (bpsByIndex.get(idx) ?? 0) + 1);
      }
    }
  }

  // 4) Armar el resultado y comprobar que cierra.
  const rows: RealtySplitComputed[] = prepared.map((p) => {
    const amountCents = centsByIndex.get(p.index) ?? 0;
    const bps = bpsByIndex.get(p.index) ?? 0;
    return {
      key: p.input.key ?? `s${p.index}`,
      party: p.party,
      realtyUserId: p.realtyUserId,
      externalName: p.externalName,
      mode: p.mode,
      pct: bpsToPct(bps),
      amount: centsToAmount(amountCents),
      amountCents,
    };
  });

  const assignedCents = rows.reduce((acc, r) => acc + r.amountCents, 0);
  const differenceCents = commissionCents - assignedCents;
  // Suma de los bps SIN recortar. pctToBps recorta cada fila a 100 porque
  // valida lo que se teclea; usarlo aquí hacía que una sola parte del 200%
  // se contara como 100% y la barra dijera "100%" con el chip gritando que
  // sobraban $100. El total tiene que poder pasarse: para eso se enseña.
  const totalBps = prepared.reduce((acc, p) => acc + (bpsByIndex.get(p.index) ?? 0), 0);

  if (commissionCents > 0 && inputs.length > 0 && differenceCents !== 0) {
    problems.push({
      code: "NO_CIERRA",
      message:
        differenceCents > 0
          ? `Falta repartir ${formatMoney(centsToAmount(differenceCents))}. El reparto tiene que sumar el 100% de la comisión.`
          : `Te pasaste por ${formatMoney(centsToAmount(-differenceCents))}. El reparto no puede ser mayor que la comisión.`,
      index: null,
    });
  }

  return {
    rows,
    commissionCents,
    assignedCents,
    differenceCents,
    difference: centsToAmount(differenceCents),
    totalBps,
    valid: problems.length === 0,
    problems,
  };
}

/** Atajo: ¿este reparto se puede guardar? */
export function isSplitValid(
  commission: MoneyLike,
  inputs: readonly RealtySplitInput[],
): boolean {
  return computeSplits(commission, inputs).valid;
}

// ── Plantillas de reparto ──────────────────────────────────────────────
// No hay tabla de plantillas en el schema (y esta ola no lo toca), así que
// las plantillas de la cuenta se DEDUCEN de lo que la inmobiliaria ya ha
// repartido: un reparto usado doce veces ES su plantilla, y encima se
// mantiene sola. Los presets de arranque cubren a quien todavía no cierra
// ninguna operación.

export interface RealtySplitTemplatePart {
  party: RealtyCommissionParty;
  pct: number;
}

export interface RealtySplitTemplate {
  /** Firma del reparto: "CAPTADOR:40|COLOCADOR:40|OFICINA:20". */
  id: string;
  /** "40 / 40 / 20" — lo que la gente reconoce de un vistazo. */
  label: string;
  parts: RealtySplitTemplatePart[];
  /** Cuántas operaciones de la cuenta usan este reparto. 0 = preset. */
  timesUsed: number;
  /** true = viene de fábrica, no del historial de la cuenta. */
  suggested: boolean;
}

/** Firma canónica de un reparto (orden fijo por parte, luego por %). */
export function templateId(parts: readonly RealtySplitTemplatePart[]): string {
  return parts
    .map((p) => `${p.party}:${pctToBps(p.pct)}`)
    .sort()
    .join("|");
}

function templateLabel(parts: readonly RealtySplitTemplatePart[]): string {
  return parts.map((p) => formatPct(p.pct).replace("%", "")).join(" / ");
}

function makeTemplate(
  parts: RealtySplitTemplatePart[],
  timesUsed: number,
  suggested: boolean,
): RealtySplitTemplate {
  return { id: templateId(parts), label: templateLabel(parts), parts, timesUsed, suggested };
}

/**
 * Presets de arranque. Son los repartos que se usan en México y que
 * reconoce cualquiera que venga de otra inmobiliaria. No son obligatorios:
 * la pantalla deja editar los porcentajes fila por fila.
 */
export const REALTY_SUGGESTED_TEMPLATES: RealtySplitTemplate[] = [
  makeTemplate(
    [
      { party: "CAPTADOR", pct: 40 },
      { party: "COLOCADOR", pct: 40 },
      { party: "OFICINA", pct: 20 },
    ],
    0,
    true,
  ),
  makeTemplate(
    [
      { party: "CAPTADOR", pct: 50 },
      { party: "COLOCADOR", pct: 50 },
    ],
    0,
    true,
  ),
  makeTemplate(
    [
      { party: "CAPTADOR", pct: 35 },
      { party: "COLOCADOR", pct: 35 },
      { party: "OFICINA", pct: 20 },
      { party: "FRANQUICIA", pct: 10 },
    ],
    0,
    true,
  ),
  makeTemplate(
    [
      { party: "COLOCADOR", pct: 70 },
      { party: "OFICINA", pct: 30 },
    ],
    0,
    true,
  ),
  makeTemplate(
    [
      { party: "CAPTADOR", pct: 25 },
      { party: "COLOCADOR", pct: 25 },
      { party: "EXTERNO", pct: 30 },
      { party: "OFICINA", pct: 20 },
    ],
    0,
    true,
  ),
];

/** Lo mínimo que necesita `inferTemplates` de cada operación ya repartida. */
export interface RealtyDealSplitShape {
  dealId: string;
  party: RealtyCommissionParty;
  pct: MoneyLike;
}

/**
 * Plantillas de la cuenta = los repartos que ya usó, más frecuentes primero,
 * y detrás los presets que no dupliquen a los suyos.
 *
 * Solo cuenta repartos que sumen 100%: uno a medias no es una plantilla.
 */
export function inferTemplates(
  splits: readonly RealtyDealSplitShape[],
  limit = 6,
): RealtySplitTemplate[] {
  const byDeal = new Map<string, RealtySplitTemplatePart[]>();
  for (const s of splits) {
    const list = byDeal.get(s.dealId) ?? [];
    list.push({ party: s.party, pct: bpsToPct(pctToBps(s.pct)) });
    byDeal.set(s.dealId, list);
  }

  const counts = new Map<string, { parts: RealtySplitTemplatePart[]; n: number }>();
  // Array.from y NO un for-of sobre .values(): el tsconfig del repo no fija
  // `target`, así que iterar un Map directo saca TS2802 en `tsc --noEmit`.
  for (const parts of Array.from(byDeal.values())) {
    const total = parts.reduce((acc, p) => acc + pctToBps(p.pct), 0);
    if (total !== PCT_TOTAL_BPS) continue;
    const id = templateId(parts);
    const entry = counts.get(id);
    if (entry) entry.n += 1;
    else {
      // Orden estable para pintar: primero quien más cobra.
      const sorted = [...parts].sort(
        (a, b) => pctToBps(b.pct) - pctToBps(a.pct) || a.party.localeCompare(b.party),
      );
      counts.set(id, { parts: sorted, n: 1 });
    }
  }

  const own = Array.from(counts.values())
    .sort((a, b) => b.n - a.n || a.parts.length - b.parts.length)
    .map((e) => makeTemplate(e.parts, e.n, false));

  const ownIds = new Set(own.map((t) => t.id));
  const fallback = REALTY_SUGGESTED_TEMPLATES.filter((t) => !ownIds.has(t.id));
  return [...own, ...fallback].slice(0, limit);
}

/** Plantilla → filas listas para el editor, con la comisión ya repartida. */
export function templateToInputs(
  template: RealtySplitTemplate,
): RealtySplitInput[] {
  return template.parts.map((p, i) => ({
    key: `t${i}`,
    party: p.party,
    realtyUserId: null,
    externalName: null,
    mode: "PCT" as const,
    pct: p.pct,
  }));
}

// ── Recibo por periodo ─────────────────────────────────────────────────
// "Devengado" = lo que ya se ganó porque la operación está CERRADA.
// "Pagado"    = lo que además ya salió de la caja (paidAt no nulo).
// La diferencia es lo que se le debe a la gente. Un split de una operación
// EN_PROCESO no se devenga: todavía se puede caer.

export interface RealtyReceiptSplitRow {
  splitId: string;
  dealId: string;
  dealKind: RealtyDealKind;
  dealStatus: RealtyDealStatus;
  /** Fecha de cierre. null = la operación aún no cierra. */
  closedAt: string | null;
  propertyTitle: string | null;
  party: RealtyCommissionParty;
  realtyUserId: string | null;
  beneficiary: string;
  pct: number;
  amount: MoneyLike;
  paidAt: string | null;
}

export interface RealtyReceiptLine {
  /** realtyUserId, o "party:OFICINA" / "ext:<nombre>" para quien no es usuario. */
  beneficiaryId: string;
  beneficiary: string;
  realtyUserId: string | null;
  party: RealtyCommissionParty;
  /** Cerradas y no pagadas + pagadas. */
  earned: number;
  paid: number;
  pending: number;
  /** Partes de operaciones EN_PROCESO: todavía no se ganan. */
  inProgress: number;
  operations: number;
  rows: RealtyReceiptSplitRow[];
}

export interface RealtyReceipt {
  from: string;
  to: string;
  lines: RealtyReceiptLine[];
  totalEarned: number;
  totalPaid: number;
  totalPending: number;
  totalInProgress: number;
  operations: number;
}

function beneficiaryKey(row: RealtyReceiptSplitRow): string {
  if (row.realtyUserId) return row.realtyUserId;
  if (isHouseParty(row.party)) return `party:${row.party}`;
  return `ext:${(row.beneficiary || "").toLowerCase()}`;
}

/**
 * Agrupa las partes de un periodo por beneficiario. NO filtra por fecha:
 * eso lo hace la consulta (el rango vive en el servidor, con la zona horaria
 * de la cuenta). Aquí solo se suma, en centavos.
 */
export function buildReceipt(
  from: string,
  to: string,
  rows: readonly RealtyReceiptSplitRow[],
): RealtyReceipt {
  const byBeneficiary = new Map<string, RealtyReceiptLine>();
  const dealIds = new Set<string>();

  let earnedCents = 0;
  let paidCents = 0;
  let progressCents = 0;

  for (const row of rows) {
    const key = beneficiaryKey(row);
    let line = byBeneficiary.get(key);
    if (!line) {
      line = {
        beneficiaryId: key,
        beneficiary: row.beneficiary,
        realtyUserId: row.realtyUserId,
        party: row.party,
        earned: 0,
        paid: 0,
        pending: 0,
        inProgress: 0,
        operations: 0,
        rows: [],
      };
      byBeneficiary.set(key, line);
    }
    line.rows.push(row);

    const cents = toCents(row.amount);
    const cerrada = row.dealStatus === "CERRADO";

    if (cerrada) {
      line.earned = centsToAmount(toCents(line.earned) + cents);
      earnedCents += cents;
      if (row.paidAt) {
        line.paid = centsToAmount(toCents(line.paid) + cents);
        paidCents += cents;
      }
      dealIds.add(row.dealId);
    } else if (row.dealStatus === "EN_PROCESO") {
      line.inProgress = centsToAmount(toCents(line.inProgress) + cents);
      progressCents += cents;
    }
    // CANCELADO no suma en ninguna columna: no se ganó ni se va a pagar.
  }

  const lines = Array.from(byBeneficiary.values()).map((line) => {
    line.pending = centsToAmount(toCents(line.earned) - toCents(line.paid));
    line.operations = new Set(
      line.rows.filter((r) => r.dealStatus === "CERRADO").map((r) => r.dealId),
    ).size;
    line.rows.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
    return line;
  });

  // Quien más se le debe, primero: es el orden con el que se paga.
  lines.sort(
    (a, b) =>
      toCents(b.pending) - toCents(a.pending) ||
      toCents(b.earned) - toCents(a.earned) ||
      a.beneficiary.localeCompare(b.beneficiary, "es-MX"),
  );

  return {
    from,
    to,
    lines,
    totalEarned: centsToAmount(earnedCents),
    totalPaid: centsToAmount(paidCents),
    totalPending: centsToAmount(earnedCents - paidCents),
    totalInProgress: centsToAmount(progressCents),
    operations: dealIds.size,
  };
}

// ── Tablero de avance y ranking ────────────────────────────────────────

export interface RealtyAgentPerfInput {
  realtyUserId: string;
  name: string;
  active: boolean;
  /** Operaciones CERRADAS del periodo. */
  closedDeals: number;
  /** Volumen (precio de operación) de lo cerrado. */
  closedVolume: MoneyLike;
  /** Su parte de la comisión de lo cerrado. */
  earnedCommission: MoneyLike;
  /** Operaciones EN_PROCESO donde participa. */
  inProgressDeals: number;
  inProgressCommission: MoneyLike;
  /** Prospectos que le tocaron en el periodo. */
  leads: number;
  /** De esos, cuántos llegaron a CIERRE. */
  leadsWon: number;
  /**
   * Minutos que tardó en la PRIMERA respuesta, uno por prospecto contestado.
   * Se manda la lista y no el promedio ya hecho: la mediana aguanta mejor el
   * prospecto que se contestó tres días después y desvía la media.
   */
  responseMinutes: number[];
}

export interface RealtyAgentPerf extends Omit<RealtyAgentPerfInput, "responseMinutes"> {
  closedVolume: number;
  earnedCommission: number;
  inProgressCommission: number;
  /** Prospectos que llegaron a cierre / prospectos. 0–100. */
  conversionPct: number;
  /** Promedio de primera respuesta, en minutos. null = nunca contestó uno. */
  avgResponseMinutes: number | null;
  /** Mediana de primera respuesta, en minutos. */
  medianResponseMinutes: number | null;
  /** Prospectos que todavía no reciben una primera respuesta. */
  unanswered: number;
  /** 1 = el que más comisión ganó en el periodo. */
  rank: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/**
 * Ordena a los asesores por comisión ganada en el periodo y calcula sus
 * indicadores. Puro: la consulta trae los conteos, esto solo los explica.
 */
export function buildRanking(rows: readonly RealtyAgentPerfInput[]): RealtyAgentPerf[] {
  const out = rows.map((r) => {
    const answered = r.responseMinutes.length;
    const avg =
      answered > 0
        ? Math.round(r.responseMinutes.reduce((a, b) => a + b, 0) / answered)
        : null;
    return {
      realtyUserId: r.realtyUserId,
      name: r.name,
      active: r.active,
      closedDeals: r.closedDeals,
      closedVolume: centsToAmount(toCents(r.closedVolume)),
      earnedCommission: centsToAmount(toCents(r.earnedCommission)),
      inProgressDeals: r.inProgressDeals,
      inProgressCommission: centsToAmount(toCents(r.inProgressCommission)),
      leads: r.leads,
      leadsWon: r.leadsWon,
      conversionPct: r.leads > 0 ? Math.round((r.leadsWon / r.leads) * 1000) / 10 : 0,
      avgResponseMinutes: avg,
      medianResponseMinutes: median(r.responseMinutes),
      unanswered: Math.max(0, r.leads - answered),
      rank: 0,
    };
  });

  out.sort(
    (a, b) =>
      toCents(b.earnedCommission) - toCents(a.earnedCommission) ||
      b.closedDeals - a.closedDeals ||
      a.name.localeCompare(b.name, "es-MX"),
  );
  out.forEach((r, i) => {
    r.rank = i + 1;
  });
  return out;
}

// ── Periodos en la zona horaria de la cuenta ───────────────────────────
// Espejo de lo que barber aprendió en caja: el corte de un mes NO es el mes
// UTC. Una operación cerrada el 31 a las 8 de la noche en Cancún cae en el
// mes siguiente si se calcula en UTC, y el recibo de dos asesores deja de
// cuadrar con el del mes pasado. Todo el rango se calcula en la zona de la
// cuenta (RealtyAccount.timezone) y el rango es SEMIABIERTO [inicio, fin).
//
// Puro y client-safe (solo Intl): el selector de periodo de la pantalla y la
// consulta del servidor usan exactamente las mismas funciones.

export const REALTY_DEFAULT_TZ = "America/Mexico_City";

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // Zona inválida en la cuenta: no se tumba la pantalla, se usa la de casa.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: REALTY_DEFAULT_TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}

function zonedParts(date: Date, tz: string): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of formatterFor(tz || REALTY_DEFAULT_TZ).formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour) % 24,
    min: Number(map.minute),
    s: Number(map.second),
  };
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - date.getTime();
}

/** Instante UTC de las 00:00 del día (y, m, d) en la zona `tz`. */
export function zonedMidnightUtc(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

/** "YYYY-MM" del instante, visto desde la zona de la cuenta. */
export function periodKeyFor(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

export function currentPeriodKey(tz: string, now: Date = new Date()): string {
  return periodKeyFor(now, tz);
}

export function isValidPeriodKey(key: unknown): key is string {
  return typeof key === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

/** Rango [inicio, fin) en UTC del mes `periodKey` en la zona `tz`. */
export function periodRange(periodKey: string, tz: string): { start: Date; end: Date } {
  const key = isValidPeriodKey(periodKey) ? periodKey : currentPeriodKey(tz);
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const m = Number(ms);
  return {
    start: zonedMidnightUtc(y, m, 1, tz),
    end: m === 12 ? zonedMidnightUtc(y + 1, 1, 1, tz) : zonedMidnightUtc(y, m + 1, 1, tz),
  };
}

/** "2026-01" + (-1) → "2025-12". */
export function shiftPeriodKey(periodKey: string, delta: number): string {
  const [ys, ms] = periodKey.split("-");
  const idx = Number(ys) * 12 + (Number(ms) - 1) + delta;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** "2026-08" → "agosto de 2026". */
export function formatPeriod(periodKey: string, locale = "es"): string {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return periodKey;
  try {
    return new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString(
      locale === "en" ? "en-US" : "es-MX",
      { month: "long", year: "numeric", timeZone: "UTC" },
    );
  } catch {
    return periodKey;
  }
}

/** "2 h 15 min" / "38 min" / "—". Lo que se lee en el tablero. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH > 0 ? `${d} d ${restH} h` : `${d} d`;
}

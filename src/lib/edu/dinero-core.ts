/**
 * DaleControl INSTITUCIONAL — EL DINERO, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Aquí vive
 * TODA la aritmética del cobro y la ÚNICA forma de escribir y de leer una
 * cantidad de dinero en este vertical. La capa que consulta está en
 * tarifas.ts (los precios) y caja.ts (los cobros).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 CENTAVOS ENTEROS, SIEMPRE. Ni float ni Decimal.
 *
 * En coma flotante 0.1 + 0.2 no da 0.3, y un tarifario con 40 renglones
 * acumula ese error hasta que el corte de caja no cuadra por un peso que
 * nadie encuentra. Un entero de centavos suma exacto, se compara exacto y
 * viaja al navegador como número.
 *
 * Consecuencia práctica: en TODO este vertical, una cantidad de dinero es
 * un `number` de centavos y se llama `…Cents`. Un número que no lleve ese
 * sufijo NO es dinero. Convertir a texto es `eduMoney`, y leer lo que
 * teclea una persona es `parseEduMoneyCents`; no hay una tercera forma.
 *
 * 🔴 LOS TOPES NO SON PARANOIA. `Int` de Postgres es de 4 bytes:
 * 2,147,483,647 centavos ≈ 21 millones de pesos. Sin topes, un cero de más
 * en el precio unitario multiplicado por la cantidad desborda la columna y
 * la escritura falla con un error de driver que no explica nada — o peor,
 * pasa. Los topes de abajo dejan cualquier suma posible por debajo de ese
 * límite CON margen.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type {
  EduChargeStatus,
  EduInstallmentStatus,
  EduPaymentMethod,
  EduFeeRule,
} from "@/lib/edu/types";
import {
  EDU_CASH_METHOD,
  EDU_CHARGE_STATUSES,
  EDU_FEE_RULES,
  EDU_MAX_PAGOS_POR_OPERACION,
  EDU_MSI_OPTIONS,
  EDU_PAYMENT_METHODS,
  EDU_PAYMENT_METHODS_COBRABLES,
  EDU_PAYMENT_METHOD_LABELS,
  EDU_PAYMENT_METHOD_SHORT,
} from "@/lib/edu/types";
// Puro y client-safe (recorta y acota texto). Se importa en vez de
// recortar a mano para que el "" de un input y el null de la base
// signifiquen lo mismo aquí que en el resto del vertical.
import { eduOptionalText } from "@/lib/edu/agenda-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · TOPES
// ═══════════════════════════════════════════════════════════════════════

/** $100,000.00 por unidad. Una unidad dental cara, no un edificio. */
export const EDU_MAX_PRICE_CENTS = 10_000_000;

/** Cuántas veces cabe el mismo procedimiento en una línea. */
export const EDU_MAX_QUANTITY = 99;

/** Líneas por cobro. Un ticket más largo que esto es dos tickets. */
export const EDU_MAX_CHARGE_ITEMS = 50;

/**
 * $1,000,000.00 por cobro. Con este tope y el de la línea, el peor caso
 * (50 líneas × 99 × $100,000) se rechaza ANTES de tocar la base, y ninguna
 * suma que se guarde puede acercarse a los 2,147,483,647 de un Int4.
 */
export const EDU_MAX_CHARGE_CENTS = 100_000_000;

/** Fondo de caja y conteo del corte. */
export const EDU_MAX_CASH_CENTS = 10_000_000;

/** Cuántos cobros lista una pantalla. Mismo criterio que el resto del vertical. */
export const EDU_CAJA_MAX_ROWS = 300;

// ═══════════════════════════════════════════════════════════════════════
// 2 · ESCRIBIR Y LEER DINERO
// ═══════════════════════════════════════════════════════════════════════

/**
 * El formateador se construye UNA vez. Construirlo dentro de la función
 * costaría un objeto Intl por cada celda de un tarifario de 40×4.
 */
const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Centavos → "$1,234.50". Es la ÚNICA forma de pintar dinero en el
 * vertical: si cada pantalla lo formatea a su manera, una escribe
 * "$1,234.5" y otra "1234.50 MXN" en el mismo recibo.
 *
 * Un valor que no es un número finito se pinta como "—" y no como "$NaN":
 * una pantalla que dice "no hay dato" es correcta; uno que dice "$NaN" es
 * un error de software delante del paciente.
 */
export function eduMoney(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return MXN.format(cents / 100);
}

/**
 * Centavos → "1234.50", el valor de un `<input>`. Sin símbolo y sin
 * separador de miles: un input con comas no se puede volver a leer.
 */
export function eduMoneyInputValue(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Lo que teclea una persona → centavos enteros. `null` = no es una
 * cantidad válida (y el que llama decide si eso es un error o un campo
 * vacío).
 *
 * 🔴 Se lee por TEXTO y no con `Math.round(x * 100)`: en coma flotante
 * 1.005 * 100 vale 100.49999999999999 y redondea a 100, o sea $1.00 por
 * algo que costaba $1.01. Partir la cadena por el punto y multiplicar
 * enteros no tiene ese problema.
 *
 * 🔴 NO acepta negativos. En esta ola ningún campo de dinero es negativo:
 * una devolución es un pago con `isRefund`, no un monto con signo. Aceptar
 * el signo aquí sería abrir la puerta a un "pago" de −$500 que cuadra
 * mágicamente cualquier corte.
 *
 * Tolera lo que la gente escribe de verdad: "$1,234.5", " 300 ", "1 234.00".
 * Rechaza más de dos decimales en vez de redondearlos: si alguien teclea
 * 99.999 hay que preguntarle, no decidir por él.
 */
export function parseEduMoneyCents(raw: unknown): number | null {
  let texto: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    texto = raw.toFixed(2);
  } else if (typeof raw === "string") {
    texto = raw.trim();
  } else {
    return null;
  }

  // Símbolo, espacios y separador de miles. Los dos espacios de la clase
  // van ESCAPADOS a propósito (el duro y el fino): son los que pega Excel y
  // los que mete el teclado de un móvil, y escritos tal cual se verían
  // idénticos a un espacio normal, así que nadie sabría que están ahí.
  texto = texto.replace(/[$\s\u00a0\u202f]/g, "").replace(/,/g, "");
  if (!texto) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;

  const [enteros, decimales = ""] = texto.split(".");
  const centavos = Number(enteros) * 100 + Number((decimales + "00").slice(0, 2));
  if (!Number.isSafeInteger(centavos)) return null;
  return centavos;
}

/**
 * Igual que la anterior pero con tope. Devuelve `null` si se pasa, para
 * que el que llama pueda dar un mensaje con el tope escrito.
 */
export function parseEduMoneyCentsMax(raw: unknown, maxCents: number): number | null {
  const v = parseEduMoneyCents(raw);
  if (v === null) return null;
  return v > maxCents ? null : v;
}

/** Cantidad de una línea: entero de 1 a EDU_MAX_QUANTITY. */
export function parseEduQuantity(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 1 || n > EDU_MAX_QUANTITY) return null;
  return n;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA ARITMÉTICA DEL COBRO
//
// Vive aquí, en funciones puras, para que la pantalla, el endpoint y el
// recibo no puedan discrepar sobre cuánto suma un ticket. La regla que
// fijan las pruebas: `subtotal − descuento == total`, SIEMPRE.
// ═══════════════════════════════════════════════════════════════════════

export interface EduLineMath {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

/**
 * cantidad × unitario − descuento, nunca por debajo de cero.
 *
 * El piso en cero es a propósito: un descuento mayor que la línea no
 * convierte el renglón en dinero que la escuela le debe al paciente. Si
 * hay que devolver dinero, eso es una devolución, no un descuento.
 */
export function eduLineTotalCents(line: EduLineMath): number {
  const bruto = line.quantity * line.unitPriceCents;
  return Math.max(0, bruto - line.discountCents);
}

export interface EduChargeTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Los tres números del ticket a partir de sus líneas.
 *
 * `discountCents` se RECORTA a lo que de verdad se descontó (el piso en
 * cero de cada línea ya se aplicó), para que el invariante
 * `subtotal − descuento == total` se cumpla también cuando alguien teclea
 * un descuento absurdo. Si no se recortara, el recibo diría "descuento
 * $900" sobre un subtotal de $500 y un total de $0, que no suma.
 */
export function eduChargeTotals(lines: EduLineMath[]): EduChargeTotals {
  let subtotalCents = 0;
  let totalCents = 0;
  for (const l of lines) {
    subtotalCents += l.quantity * l.unitPriceCents;
    totalCents += eduLineTotalCents(l);
  }
  return { subtotalCents, discountCents: subtotalCents - totalCents, totalCents };
}

/**
 * En qué estado queda un cobro. Se DERIVA; no se captura nunca.
 *
 * El orden de las ramas importa:
 *  · cancelado gana a todo — ya no se le debe nada a nadie;
 *  · un total de cero nace LIQUIDADO (el tamizaje gratis de la escuela no
 *    puede quedarse "pendiente" para siempre en la lista de cobranza);
 *  · pagado y devuelto hasta volver a cero es DEVUELTO, no "pendiente":
 *    son dos historias distintas y el corte las cuenta distinto.
 */
export function eduChargeStatusFor(input: {
  cancelled: boolean;
  totalCents: number;
  paidCents: number;
  hasRefund: boolean;
}): EduChargeStatus {
  if (input.cancelled) return "CANCELLED";
  if (input.totalCents <= 0) return "PAID";
  if (input.paidCents >= input.totalCents) return "PAID";
  if (input.paidCents <= 0) return input.hasRefund ? "REFUNDED" : "PENDING";
  return "PARTIAL";
}

/**
 * 🔴 EL SALDO VIVO. Un cobro CANCELADO debe CERO.
 *
 * Esta función existe por un bug que ya se pagó en el producto dental:
 * cancelar una factura marcaba el estado y dejaba el `balance` intacto, así
 * que la ficha del paciente seguía ofreciendo "Cobrar ahora · $1,800" de
 * algo anulado, y lo mismo hacían el corte de caja y cuatro pantallas más.
 *
 * Aquí se cierra por los dos lados: la columna `balanceCents` se escribe en
 * 0 al cancelar Y toda suma filtra por estado. Esta función es la tercera
 * cerradura, la que usa la UI.
 */
export function eduSaldoVivoCents(charge: {
  status: EduChargeStatus;
  totalCents: number;
  paidCents: number;
}): number {
  if (charge.status === "CANCELLED") return 0;
  return Math.max(0, charge.totalCents - charge.paidCents);
}

/** Los estados que NO cuentan como dinero por cobrar. */
export const EDU_CHARGE_DEAD_STATUSES: EduChargeStatus[] = ["CANCELLED"];

// ═══════════════════════════════════════════════════════════════════════
// 4 · PARSEO DE LO QUE VIENE DEL CLIENTE
// ═══════════════════════════════════════════════════════════════════════

export function parseEduPaymentMethod(raw: unknown): EduPaymentMethod | null {
  if (typeof raw !== "string") return null;
  return (EDU_PAYMENT_METHODS as string[]).includes(raw) ? (raw as EduPaymentMethod) : null;
}

export function parseEduChargeStatus(raw: unknown): EduChargeStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_CHARGE_STATUSES as string[]).includes(raw) ? (raw as EduChargeStatus) : null;
}

export function parseEduFeeRule(raw: unknown): EduFeeRule | null {
  if (typeof raw !== "string") return null;
  return (EDU_FEE_RULES as string[]).includes(raw) ? (raw as EduFeeRule) : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4b · 🔴 EL PAGO DIVIDIDO: hasta TRES formas en UNA operación
//
// Lo que se vio en el mostrador: el paciente trae $500 en efectivo y el
// resto con tarjeta, y la caja solo aceptaba UN método. La salida era
// mentir en el método (todo "efectivo") o partir el cobro en dos, que
// descuadra el recibo y el CFDI.
//
// La forma de arreglarlo NO es una columna nueva con "el otro método":
// cada forma es su PROPIA fila de EduPayment, con su método, su monto
// POSITIVO y su referencia. Así el corte las cuenta una por una, la
// factura las ve todas y no hay ningún número que sumar a mano.
//
// Esta función es la ÚNICA que valida esa lista, y la usan LOS DOS LADOS:
// el servidor antes de abrir la transacción y la pantalla mientras se
// teclea. Si fueran dos validaciones distintas, la pantalla dejaría
// apretar un botón que el servidor rebota.
// ═══════════════════════════════════════════════════════════════════════

/** Una forma de pago YA validada. Lo que se escribe, fila por fila. */
export interface EduPagoValidado {
  method: EduPaymentMethod;
  /** Centavos POSITIVOS, también en una devolución: el signo es isRefund. */
  amountCents: number;
  isRefund: boolean;
  reference: string | null;
  notes: string | null;
  /** Meses sin intereses DEL BANCO. Solo con CARD_CREDIT. */
  msiMonths: number | null;
}

export type EduPagosFailure = { ok: false; error: string };
export type EduPagosResult =
  | { ok: true; pagos: EduPagoValidado[]; sumaCents: number; restanteCents: number }
  | EduPagosFailure;

/**
 * 🔴 La guarda viaja JUNTO a la unión: el tsconfig del repo corre con
 * strict:false y ahí TypeScript NO estrecha una unión por su discriminante
 * booleano — `if (!r.ok) r.error` revienta en el build con TS2339. Mismo
 * patrón que `eduPlanRequestFailed` (pagos-core.ts).
 */
export function eduPagosFailed(r: EduPagosResult): r is EduPagosFailure {
  return r.ok === false;
}

function enteroDe(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Lee las formas de pago de una operación y las valida TODAS o ninguna.
 *
 * Acepta las dos formas del cuerpo, a propósito:
 *   · `payments: [ … ]` — de 1 a EDU_MAX_PAGOS_POR_OPERACION;
 *   · `payment: { … }`  — el pago único de siempre, que se envuelve en una
 *     lista de uno. Los clientes viejos (y las pruebas viejas) siguen
 *     funcionando sin tocar una línea.
 *
 * Las reglas, y por qué:
 *   · métodos REPETIDOS sí se permiten: dos tarjetas distintas son dos
 *     formas legítimas, y prohibirlo obligaría a mentir en una;
 *   · `CARD` (legado) se RECHAZA con un mensaje que dice qué elegir: la
 *     fila vieja se puede leer, pero no se puede crear una nueva sin saber
 *     si fue débito o crédito;
 *   · `msiMonths` con un método que no sea crédito es un ERROR y no se
 *     ignora en silencio: ignorarlo perdería un dato que alguien tecleó;
 *   · `OTHER` exige el motivo y `CHECK` exige la referencia, porque un
 *     "otro" sin explicar y un cheque sin número son un agujero en el
 *     arqueo el día que haya que buscarlos;
 *   · una DEVOLUCIÓN no se divide: es UN movimiento, y partirlo en tres
 *     haría imposible cuadrarlo contra el pago que revierte.
 *
 * Devuelve el error ESCRITO para una persona en vez de lanzar: este módulo
 * es puro y quien llama decide el status HTTP.
 */
export function parseEduPagosDivididos(
  raw: unknown,
  objetivoCents: number,
  opts: { exacto: boolean; canRefund?: boolean },
): EduPagosResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "La forma de pago no es válida." };
  }
  const r = raw as Record<string, unknown>;

  let lista: unknown[];
  if (r.payments !== undefined && r.payments !== null) {
    if (!Array.isArray(r.payments)) {
      return { ok: false, error: "Las formas de pago tienen que venir en una lista." };
    }
    lista = r.payments;
  } else if (r.payment !== undefined && r.payment !== null && r.payment !== "") {
    lista = [r.payment];
  } else {
    return { ok: false, error: "No viene ninguna forma de pago." };
  }

  if (lista.length === 0) {
    return { ok: false, error: "Elige al menos una forma de pago." };
  }
  if (lista.length > EDU_MAX_PAGOS_POR_OPERACION) {
    return {
      ok: false,
      error: `Un pago se divide en ${EDU_MAX_PAGOS_POR_OPERACION} formas como mucho; llegaron ${lista.length}.`,
    };
  }

  const pagos: EduPagoValidado[] = [];
  let sumaCents = 0;
  let hayDevolucion = false;

  for (let i = 0; i < lista.length; i++) {
    // Con una sola forma, decir "(forma 1)" sobra y confunde.
    const cual = lista.length > 1 ? ` (forma ${i + 1} de ${lista.length})` : "";
    const item = lista[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, error: `Esa forma de pago no es válida${cual}.` };
    }
    const p = item as Record<string, unknown>;

    const method = p.method === undefined ? EDU_CASH_METHOD : parseEduPaymentMethod(p.method);
    if (!method) return { ok: false, error: `Ese método de pago no existe${cual}.` };
    if (!(EDU_PAYMENT_METHODS_COBRABLES as string[]).includes(method)) {
      return {
        ok: false,
        error: `“${EDU_PAYMENT_METHOD_LABELS[method]}” ya no se puede elegir${cual}: elige débito o crédito.`,
      };
    }

    const amountCents = parseEduMoneyCentsMax(p.amountCents, EDU_MAX_CHARGE_CENTS);
    if (amountCents === null) {
      return {
        ok: false,
        error: `Ese monto no es una cantidad válida${cual} (máximo ${eduMoney(EDU_MAX_CHARGE_CENTS)}).`,
      };
    }
    if (amountCents <= 0) {
      return { ok: false, error: `El monto tiene que ser mayor que cero${cual}.` };
    }

    let msiMonths: number | null = null;
    if (p.msiMonths !== undefined && p.msiMonths !== null && p.msiMonths !== "") {
      if (method !== "CARD_CREDIT") {
        return {
          ok: false,
          error: `Los meses sin intereses los da el banco con tarjeta de crédito${cual}: con ${EDU_PAYMENT_METHOD_LABELS[
            method
          ].toLowerCase()} no aplican.`,
        };
      }
      const n = enteroDe(p.msiMonths);
      if (n === null || !EDU_MSI_OPTIONS.includes(n)) {
        return {
          ok: false,
          error: `Los meses sin intereses del banco solo pueden ser ${EDU_MSI_OPTIONS.join(", ")}${cual}.`,
        };
      }
      msiMonths = n;
    }

    const reference = eduOptionalText(p.reference, 80) ?? null;
    const notes = eduOptionalText(p.notes, 300) ?? null;
    if (method === "OTHER" && (notes === null || notes.length < 3)) {
      return {
        ok: false,
        error: `“Otro” pide que escribas el motivo${cual}: una beca, un vale, una cortesía (al menos 3 letras).`,
      };
    }
    if (method === "CHECK" && reference === null) {
      return {
        ok: false,
        error: `Un cheque pide su referencia${cual}: el número y el banco.`,
      };
    }

    const isRefund = Boolean(p.isRefund);
    if (isRefund) {
      if (lista.length > 1) {
        return {
          ok: false,
          error: "Una devolución no se divide en varias formas: es un solo movimiento.",
        };
      }
      if (!opts.canRefund) {
        return { ok: false, error: "Tu cuenta no puede devolver dinero (permiso caja.refund)." };
      }
      hayDevolucion = true;
    }

    pagos.push({ method, amountCents, isRefund, reference, notes, msiMonths });
    sumaCents += amountCents;
  }

  if (sumaCents > objetivoCents) {
    return {
      ok: false,
      error: hayDevolucion
        ? `No puedes devolver ${eduMoney(sumaCents)}: el paciente solo ha pagado ${eduMoney(objetivoCents)}.`
        : `Las formas de pago suman ${eduMoney(sumaCents)} y como mucho caben ${eduMoney(
            objetivoCents,
          )}. Sobran ${eduMoney(sumaCents - objetivoCents)}.`,
    };
  }
  if (opts.exacto && sumaCents !== objetivoCents) {
    return {
      ok: false,
      error: `Faltan ${eduMoney(objetivoCents - sumaCents)}: se cobra ${eduMoney(
        objetivoCents,
      )} exactos. Una mensualidad se divide entre FORMAS de pago, nunca entre meses.`,
    };
  }

  return { ok: true, pagos, sumaCents, restanteCents: objetivoCents - sumaCents };
}

/**
 * 🔴 ¿ESTE CUERPO PIDE UNA DEVOLUCIÓN? Con la MISMA precedencia con la que
 * `parseEduPagosDivididos` decide qué lista lee: `payments` gana a
 * `payment`, y `payment` gana al pago suelto de la raíz.
 *
 * Existe porque quien llama tiene que elegir el TOPE **antes** de validar
 * —devolver se topa con lo pagado, cobrar con el saldo— y esa decisión no
 * puede leer el cuerpo con otra regla que la del parser.
 *
 * El bug que cierra, encontrado por el refutador: la forma "obvia"
 * (`Boolean(raw.isRefund ?? raw.payment?.isRefund)`) NO cae al lado
 * derecho cuando el izquierdo es `false` —`??` solo mira null y
 * undefined—, así que un cuerpo con `isRefund: false` en la raíz y
 * `payment.isRefund: true` dentro elegía el tope del COBRO para una
 * DEVOLUCIÓN. No llegaba a sacar dinero de más (el candado de
 * `eduApplyEduPaymentInTx` lo paraba), pero fallaba con "otro movimiento
 * entró antes" sin que hubiera entrado ninguno: un error que miente.
 */
export function eduPagosPideDevolucion(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.payments)) {
    return r.payments.some((p) => Boolean((p as { isRefund?: unknown } | null)?.isRefund));
  }
  if (r.payment !== undefined && r.payment !== null && r.payment !== "") {
    return Boolean((r.payment as { isRefund?: unknown }).isRefund);
  }
  return Boolean(r.isRefund);
}

/**
 * EL CAMBIO del efectivo: lo recibido menos lo que se cobra.
 *
 * `null` = todavía no alcanza (o no es un número), y la pantalla escribe
 * "faltan $X" en vez de un cambio negativo. Un cambio en rojo delante del
 * paciente se lee como "el sistema le debe dinero", que no es lo que pasa.
 *
 * 🔴 El recibido NO viaja al servidor y NO se guarda: el pago es lo que se
 * cobra, no lo que se puso sobre el mostrador. Esto es aritmética de
 * pantalla para que nadie tenga que hacerla de cabeza.
 */
export function eduCambioCents(recibidoCents: number, aCobrarCents: number): number | null {
  if (!Number.isFinite(recibidoCents) || !Number.isFinite(aCobrarCents)) return null;
  if (recibidoCents < 0 || aCobrarCents < 0) return null;
  if (recibidoCents < aCobrarCents) return null;
  return recibidoCents - aCobrarCents;
}

export interface EduPagoParaResumen {
  method: EduPaymentMethod;
  isRefund: boolean;
  amountCents: number;
}

/**
 * Los métodos DISTINTOS con los que se pagó, de mayor a menor monto.
 *
 * Las devoluciones NO cuentan: la fila de la lista tiene que decir cómo
 * pagó el paciente, y un reembolso en efectivo de un cobro con tarjeta
 * pondría "Efectivo" en un cobro que nadie pagó en efectivo.
 */
export function eduMetodosDistintos(pagos: EduPagoParaResumen[]): EduPaymentMethod[] {
  if (!Array.isArray(pagos)) return [];
  const suma = new Map<EduPaymentMethod, number>();
  for (const p of pagos) {
    if (!p || p.isRefund) continue;
    if (!(EDU_PAYMENT_METHODS as string[]).includes(p.method)) continue;
    const monto = Number.isFinite(p.amountCents) ? p.amountCents : 0;
    suma.set(p.method, (suma.get(p.method) ?? 0) + monto);
  }
  const pares: [EduPaymentMethod, number][] = [];
  suma.forEach((total, method) => pares.push([method, total]));
  return pares
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        // Empate: el orden del enum, para que la misma pareja de métodos
        // se pinte siempre igual y la lista no "baile" entre recargas.
        EDU_PAYMENT_METHODS.indexOf(a[0]) - EDU_PAYMENT_METHODS.indexOf(b[0]),
    )
    .map(([m]) => m);
}

/** "Efectivo" · "Efectivo + Crédito" · "—" si no se ha pagado nada. */
export function eduMetodosResumen(pagos: EduPagoParaResumen[]): string {
  const metodos = eduMetodosDistintos(pagos);
  if (metodos.length === 0) return "—";
  return metodos.map((m) => EDU_PAYMENT_METHOD_SHORT[m]).join(" + ");
}

/**
 * Clave de una lista de precios o de un procedimiento: minúsculas, sin
 * espacios, solo letras, números y guion. Se normaliza porque el índice
 * único es (institutionId, key) y Postgres distingue mayúsculas: sin esto
 * "Alumno" y "alumno" serían dos listas distintas con el mismo nombre
 * impreso.
 */
export function normalizeEduKey(raw: unknown, maxLength = 40): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!v || v.length > maxLength) return null;
  return v;
}

/** Clave del procedimiento: MAYÚSCULAS, como en el tarifario de la pared. */
export function normalizeEduProcedureCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (!v || v.length > 20) return null;
  return v;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · FILTROS DE LAS PANTALLAS
// ═══════════════════════════════════════════════════════════════════════

export interface EduChargeFilters {
  status: EduChargeStatus | null;
  patientId: string | null;
  /** true = solo lo del turno abierto; false = todo lo que se pueda ver. */
  soloTurno: boolean;
  /**
   * ¿Lo PIDIÓ la persona, o es el default?
   *
   * 🔴 Es la columna que arregla el fallo que se vio en producción: se
   * cobraba, el recibo se emitía… y la lista salía vacía, porque el
   * default es "solo el turno abierto" y no había ningún turno abierto.
   * Desde fuera se veía como que el cobro no se había guardado.
   *
   * Con esta bandera se distinguen dos cosas que antes eran la misma:
   *   · nadie tocó el selector → si no hay turno, se enseña el HISTÓRICO
   *     (con su aviso), porque lo que la persona quiere ver es el cobro
   *     que acaba de hacer;
   *   · la persona ELIGIÓ "solo el turno abierto" → se respeta y sale
   *     vacío, porque eso fue exactamente lo que pidió.
   */
  turnoExplicito: boolean;
  q: string | null;
}

export const EDU_CHARGE_EMPTY_FILTERS: EduChargeFilters = {
  status: null,
  patientId: null,
  soloTurno: true,
  turnoExplicito: false,
  q: null,
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

function cleanId(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * Lee los filtros de la query string. Lo que no reconoce, lo descarta.
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión; si
 * esto lo aceptara, bastaría teclear `?institutionId=…` para leer la caja
 * de otra escuela.
 */
export function parseEduChargeFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduChargeFilters {
  const sp = searchParams ?? {};
  const busqueda = firstParam(sp.q);
  const ver = firstParam(sp.ver);
  return {
    status: parseEduChargeStatus(firstParam(sp.estado)),
    patientId: cleanId(sp.paciente),
    // El default es el TURNO: quien abre caja quiere ver lo de su turno,
    // no el histórico del instituto. Pero solo mientras HAYA turno —lo
    // resuelve eduResolveChargeView con ese dato en la mano.
    soloTurno: ver !== "todos",
    turnoExplicito: ver === "todos" || ver === "turno",
    q: busqueda && busqueda.trim() ? busqueda.trim().slice(0, 60) : null,
  };
}

export function eduHasChargeFilters(f: EduChargeFilters): boolean {
  // El selector cuenta como filtro cuando la persona LO TOCÓ, no cuando el
  // sistema cayó al histórico por no haber turno: si contara, el botón de
  // "Limpiar" aparecería en una pantalla que nadie filtró.
  return Boolean(f.status || f.patientId || f.q || f.turnoExplicito);
}

/**
 * QUÉ SE LISTA DE VERDAD, con el turno ya consultado.
 *
 * 🔴 EL FALLO QUE ARREGLA, tal como se vio en producción: recepción cobra,
 * el recibo sale, y la lista de /instituto/caja aparece VACÍA. No es que
 * el cobro no se guardara — es que el filtro por defecto era "solo el
 * turno abierto" y no había ninguno abierto, así que el `where` pedía
 * `cashSessionId = "__sin_turno__"` y no devolvía nada. Desde el mostrador
 * se ve exactamente igual que un cobro perdido.
 *
 * La regla, en dos líneas:
 *   · sin turno abierto y sin que nadie tocara el selector → HISTÓRICO,
 *     con un aviso que explica por qué;
 *   · con el selector puesto a mano en "solo el turno abierto" → se
 *     respeta aunque salga vacío. Lo pidió una persona.
 *
 * Es puro (recibe si hay turno, no lo consulta) para poder probarlo sin
 * base de datos.
 */
export interface EduChargeView {
  /** Lo que hay que aplicar en el `where`. */
  soloTurno: boolean;
  /** true = se cayó al histórico porque no hay turno. La pantalla lo dice. */
  fallbackSinTurno: boolean;
}

export function eduResolveChargeView(
  filters: EduChargeFilters,
  hayTurnoAbierto: boolean,
): EduChargeView {
  if (!filters.soloTurno) return { soloTurno: false, fallbackSinTurno: false };
  if (hayTurnoAbierto) return { soloTurno: true, fallbackSinTurno: false };
  if (filters.turnoExplicito) return { soloTurno: true, fallbackSinTurno: false };
  return { soloTurno: false, fallbackSinTurno: true };
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Se declaran aquí (módulo puro) para que la página server y el componente
// cliente lean el MISMO tipo. Todo lo que sale hacia el navegador es
// serializable: fechas en ISO, dinero en centavos.
// ═══════════════════════════════════════════════════════════════════════

export interface EduProcedureRow {
  id: string;
  code: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  isActive: boolean;
  orderIndex: number;
  /** En cuántas listas tiene precio. Lo pinta el catálogo. */
  pricedIn: number;
}

export interface EduFeeScheduleRow {
  id: string;
  key: string;
  name: string;
  rule: EduFeeRule;
  isDefault: boolean;
  isActive: boolean;
  orderIndex: number;
  notes: string | null;
  /** Cuántos procedimientos tienen precio en esta lista. */
  itemCount: number;
}

/** Una celda de la tabla comparativa: el precio de un procedimiento en una lista. */
export interface EduTarifaCell {
  feeScheduleId: string;
  priceCents: number | null;
}

export interface EduTarifaRow {
  procedure: EduProcedureRow;
  cells: EduTarifaCell[];
}

/** La tabla comparativa completa: N listas × M procedimientos. */
export interface EduTarifario {
  schedules: EduFeeScheduleRow[];
  rows: EduTarifaRow[];
  truncated: boolean;
}

/** Por qué a este paciente le tocó ESTA lista. Se pinta tal cual en caja. */
export interface EduTarifaMatch {
  feeScheduleId: string;
  feeScheduleName: string;
  feeScheduleKey: string;
  /** "Lo trajo la alumna Sofía Ibarra (A-014)" / "Llegó solo a la clínica". */
  reason: string;
  /** true si se cayó a la lista default porque ninguna regla disparó. */
  isDefault: boolean;
}

/** El precio de UN procedimiento para UN paciente, ya resuelto. */
export interface EduPrecioResuelto {
  procedureId: string;
  code: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  priceCents: number;
  /** De qué lista salió el precio (puede no ser la que le tocaba). */
  fromFeeScheduleId: string;
  fromFeeScheduleName: string;
  /**
   * true = la lista que le tocaba NO tiene este procedimiento y el precio
   * salió de la lista default. La pantalla lo DICE en vez de callarlo.
   */
  fallback: boolean;
}

export interface EduChargeItemRow {
  id: string;
  procedureId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  /** El precio que mandó el navegador y se descartó. null = no hubo. */
  clientPriceCents: number | null;
}

export interface EduPaymentRow {
  id: string;
  method: EduPaymentMethod;
  amountCents: number;
  isRefund: boolean;
  reference: string | null;
  notes: string | null;
  paidAt: string;
  /**
   * El INSTANTE ya escrito, en la zona del INSTITUTO y por el servidor:
   * "15 de septiembre de 2026, 13:40". Formatearlo en el cliente pintaría
   * la zona del navegador y rompería la hidratación.
   */
  paidAtLabel: string;
  receivedByName: string;
  /** Meses sin intereses DEL BANCO, si los hubo (solo con crédito). */
  msiMonths: number | null;
  /** Si este pago fue de una mensualidad: cuál, y de cuántas. */
  installmentNumber: number | null;
  installmentMonths: number | null;
}

export interface EduChargeRow {
  id: string;
  folio: string;
  patientId: string;
  patientName: string;
  patientFolio: string;
  caseId: string | null;
  feeScheduleLabel: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: EduChargeStatus;
  notes: string | null;
  chargedByName: string;
  chargedAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  items: EduChargeItemRow[];
  payments: EduPaymentRow[];
  /**
   * Con qué se pagó, sin repetir y de mayor a menor monto. La fila de la
   * lista pinta "Efectivo + Crédito" sin abrir el recibo.
   */
  methods: EduPaymentMethod[];
  /**
   * Pagos a meses: el plan ACTIVO del cobro, si hay (a lo sumo uno). Con
   * esto el recibo enlaza al plan y esconde el pago suelto — que el
   * servidor rebotaría igual: un cobro diferido se cobra por mensualidad.
   */
  activePlanId: string | null;
  /**
   * 🔴 EL PLAN, YA DERIVADO. Es lo que arregla el "no se sabe cada cuándo
   * paga": con solo el `activePlanId` la lista de Caja no podía decir ni
   * cuántas van ni cuándo vence la siguiente, y el calendario quedaba dos
   * clics más lejos. Se deriva en la lectura (con el hoy del INSTITUTO,
   * como todo lo de VENCIDA), no se guarda.
   *
   * `null` = este cobro no tiene plan activo.
   */
  plan: {
    id: string;
    months: number;
    paidCount: number;
    /** La mensualidad "pareja"; la PRIMERA puede traer los centavos de más. */
    installmentCents: number;
    /** La siguiente sin pagar, "AAAA-MM-DD". null = no queda ninguna. */
    nextDueISO: string | null;
    overdueCount: number;
    pendingCents: number;
    /**
     * El calendario COMPLETO, para pintarlo dentro del recibo del cobro y
     * poder cobrar la siguiente ahí mismo. Viaja aquí y no se pide en una
     * segunda consulta porque ya se leyó para derivar los números de
     * arriba: pedirlo otra vez sería un viaje de red para dibujar lo que
     * ya está en la mano.
     */
    installments: {
      id: string;
      number: number;
      amountCents: number;
      dueDateISO: string;
      status: EduInstallmentStatus;
    }[];
  } | null;
}

export interface EduChargesPage {
  rows: EduChargeRow[];
  truncated: boolean;
  /** Suma de lo cobrado y lo pendiente de las filas devueltas. */
  totals: { totalCents: number; paidCents: number; balanceCents: number };
  /**
   * QUÉ SE LISTÓ de verdad. La pantalla pinta el selector y el vacío con
   * ESTO y no con los filtros de la URL: si leyera los filtros, el
   * selector diría "solo el turno abierto" mientras la tabla enseña el
   * histórico, y nadie entendería qué está viendo.
   */
  applied: EduChargeView;
}

/** Un renglón del corte: cuánto entró por cada método. */
export interface EduCorteMethodRow {
  method: EduPaymentMethod;
  chargedCents: number;
  refundedCents: number;
  netCents: number;
  count: number;
}

export interface EduCashSessionRow {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCents: number;
  countedCents: number | null;
  expectedCents: number | null;
  differenceCents: number | null;
  notes: string | null;
  openedByName: string;
  closedByName: string | null;
}

export interface EduCorte {
  session: EduCashSessionRow | null;
  /** Cierre del turno: los renglones por método dentro de la ventana. */
  methods: EduCorteMethodRow[];
  /** Efectivo esperado en el cajón: fondo + efectivo − devoluciones. */
  expectedCashCents: number;
  /** Neto de TODOS los métodos. */
  netCents: number;
  refundedCents: number;
  /** Cobros emitidos en el turno y lo que quedó a deber. */
  chargeCount: number;
  chargedCents: number;
  pendingCents: number;
  /**
   * Cuántos días naturales abarca la ventana del turno. >1 significa que
   * el turno lleva abierto más de un día y la pantalla tiene que decirlo
   * en vez de titular "hoy" unos datos que no son de hoy.
   */
  spanDays: number;
  /** Turnos cerrados recientes, para poder reimprimir un corte. */
  previous: EduCashSessionRow[];
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL CORTE, EN ARITMÉTICA PURA
// ═══════════════════════════════════════════════════════════════════════

export interface EduCortePaymentInput {
  method: EduPaymentMethod;
  amountCents: number;
  isRefund: boolean;
}

/**
 * Los renglones del corte a partir de los pagos de la ventana.
 *
 * 🔴 Una devolución NO se resta del renglón de "cobrado": se cuenta en su
 * propia columna. Un corte que enseña un solo neto esconde que hubo que
 * devolver $1,500, que es justo el número por el que pregunta la dirección.
 *
 * Devuelve SIEMPRE los SIETE métodos, también en cero. Una tabla de corte
 * a la que le faltan renglones obliga a leerla dos veces para saber si
 * "no hubo tarjeta" o "se me olvidó mirar". Cuál de los siete se PINTA lo
 * decide `eduCorteMethodsVisibles`, aquí abajo.
 */
export function eduCorteMethods(pagos: EduCortePaymentInput[]): EduCorteMethodRow[] {
  const base = new Map<EduPaymentMethod, EduCorteMethodRow>();
  for (const m of EDU_PAYMENT_METHODS) {
    base.set(m, { method: m, chargedCents: 0, refundedCents: 0, netCents: 0, count: 0 });
  }
  for (const p of pagos) {
    const row = base.get(p.method);
    if (!row) continue;
    if (p.isRefund) row.refundedCents += p.amountCents;
    else row.chargedCents += p.amountCents;
    row.netCents = row.chargedCents - row.refundedCents;
    row.count += 1;
  }
  return EDU_PAYMENT_METHODS.map((m) => base.get(m) as EduCorteMethodRow);
}

/**
 * QUÉ RENGLONES SE PINTAN en el corte.
 *
 * Los COBRABLES siempre, también en cero (ver arriba: una tabla con
 * huecos obliga a leerla dos veces). El legado `CARD` —"Tarjeta (sin
 * especificar)"— SOLO si de verdad hubo movimientos con él: un renglón
 * permanente en cero de un método que ya nadie puede elegir es ruido en
 * la hoja que alguien firma al cerrar el turno.
 */
export function eduCorteMethodsVisibles(rows: EduCorteMethodRow[]): EduCorteMethodRow[] {
  const porMetodo = new Map<EduPaymentMethod, EduCorteMethodRow>();
  for (const r of rows ?? []) {
    if (r) porMetodo.set(r.method, r);
  }
  const vacio = (method: EduPaymentMethod): EduCorteMethodRow => ({
    method,
    chargedCents: 0,
    refundedCents: 0,
    netCents: 0,
    count: 0,
  });
  return EDU_PAYMENT_METHODS.filter((m) => {
    if ((EDU_PAYMENT_METHODS_COBRABLES as string[]).includes(m)) return true;
    return (porMetodo.get(m)?.count ?? 0) > 0;
  }).map((m) => porMetodo.get(m) ?? vacio(m));
}

/**
 * LA TERMINAL: débito + crédito + el legado `CARD`, en NETO.
 *
 * Es el número que se compara contra el corte que imprime la terminal
 * bancaria al final del día, y que desde que hay dos renglones de tarjeta
 * habría que sumar de cabeza. El efectivo esperado del cajón NO cambia por
 * esto: sigue siendo solo `EDU_CASH_METHOD`, porque una tarjeta no mete un
 * peso en el cajón.
 */
export function eduCorteTerminalCents(rows: EduCorteMethodRow[]): number {
  const TERMINAL: EduPaymentMethod[] = ["CARD_DEBIT", "CARD_CREDIT", "CARD"];
  let total = 0;
  for (const r of rows ?? []) {
    if (r && TERMINAL.includes(r.method)) total += r.netCents;
  }
  return total;
}

/**
 * Cuántos días naturales abarca la ventana del turno, CONTANDO el día en
 * que se abrió.
 *
 * Un turno que se abrió ayer y solo cobró hoy también cruza días, y el
 * corte tiene que decirlo. Se cuenta en la zona del instituto — en UTC, un
 * turno de las 20:00 a las 22:00 en México cruzaría de día él solo.
 */
export function eduCorteSpanDays(
  openedAt: Date,
  hasta: Date,
  timeZone: string,
): number {
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const a = dia(openedAt);
  const b = dia(hasta);
  if (a === b) return 1;
  // Diferencia en días entre dos fechas de calendario "AAAA-MM-DD".
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.round(ms / 86_400_000) + 1;
}

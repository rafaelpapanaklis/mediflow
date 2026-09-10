/**
 * DaleControl INSTITUCIONAL — EL DESGLOSE GUARDADO DEL CORTE · parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido. Define la FORMA del JSON que
 * `EduCashSession.methodBreakdown` guarda al cerrar el turno, cómo se
 * arma y cómo se vuelve a leer.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (H-53)
 *
 * «De los turnos cerrados solo quedan los últimos 10, sin detalle y sin
 * reimpresión — y el código promete la reimpresión (`dinero-core.ts:615`
 * dice literalmente "para poder reimprimir un corte"). El desglose por
 * método NO SE GUARDA: se pierde al cerrar.»
 *
 * El corte del 14 de febrero es hoy inalcanzable desde el panel. Con esta
 * columna, el corte impreso se puede volver a imprimir dentro de un año
 * exactamente igual que salió: no se recalcula, se LEE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SE ESCRIBE UNA VEZ Y NO SE VUELVE A TOCAR. Es la foto congelada del
 * corte, la misma decisión que `expectedCents` y `differenceCents`, que ya
 * se congelan al cerrar «para que el corte impreso no cambie si mañana
 * alguien registra un pago con fecha vieja». Recalcularlo al leerlo sería
 * deshacer eso mismo.
 *
 * 🔴 JSON Y NO OCHO COLUMNAS. `EduPaymentMethod` es un enum que ya creció
 * una vez (CARD se partió en CARD_DEBIT y CARD_CREDIT por el SAT), y una
 * columna por método convertiría el siguiente método en una migración.
 * Aquí la validación la hace este archivo, no la base.
 *
 * ⛔ ESTE ARCHIVO NO ESCRIBE NADA. La transacción que cierra el turno vive
 * en src/lib/edu/caja.ts, que es de otra casilla de esta ola; aquí está la
 * forma y la aritmética para que esa casilla solo tenga que llamarla.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduPaymentMethod } from "@/lib/edu/types";
import { EDU_PAYMENT_METHODS } from "@/lib/edu/types";

/** La versión de la FORMA del JSON, guardada dentro del propio JSON. */
export const EDU_CORTE_DESGLOSE_VERSION = 1;

/** Un renglón del desglose: un método con lo cobrado y lo devuelto. */
export interface EduCorteDesgloseRenglon {
  method: EduPaymentMethod;
  /** Cuántos movimientos hubo. Es lo que se imprime al lado del importe. */
  count: number;
  /** Cobrado, en centavos. Siempre positivo. */
  chargedCents: number;
  /** Devuelto, en centavos. Siempre positivo (el signo lo pone el rótulo). */
  refundedCents: number;
  /** cobrado − devuelto. Puede ser negativo: un turno de puras devoluciones. */
  netCents: number;
}

/**
 * El JSON completo.
 *
 * `version` va DENTRO y no en una columna aparte: el día que esta forma
 * cambie, un corte guardado con la v1 tiene que poder seguir leyéndose
 * exactamente como se guardó — y eso solo se puede si el propio renglón
 * dice de qué versión es.
 */
export interface EduCorteDesglose {
  version: number;
  /** Los métodos que TUVIERON movimiento, en el orden del catálogo. */
  renglones: EduCorteDesgloseRenglon[];
  /** La suma de los netos. Es la comprobación de que el desglose cuadra. */
  netoTotalCents: number;
}

export interface EduPagoLike {
  method: EduPaymentMethod | string;
  amountCents: number;
  isRefund: boolean;
}

/**
 * Arma el desglose a partir de los pagos del turno.
 *
 * 🔴 SOLO LOS MÉTODOS CON MOVIMIENTO. Un corte con siete renglones en cero
 * y uno con dinero es un corte que nadie lee: el ojo busca el número y lo
 * encuentra rodeado de ruido. Los que no tuvieron nada no salen.
 *
 * 🔴 EL ORDEN ES EL DEL CATÁLOGO (`EDU_PAYMENT_METHODS`) Y NO EL DEL
 * IMPORTE. Un corte que reordena sus renglones cada día no se puede
 * comparar con el de ayer de un vistazo, que es exactamente lo que hace
 * quien cuadra una caja.
 *
 * ⚠️ Un método desconocido (una fila vieja, o un enum que creció por
 * delante del código) NO se descarta: se suma igual. Perder dinero del
 * corte porque el rótulo no está en una lista es peor que imprimir un
 * rótulo feo.
 */
export function eduCorteDesglose(pagos: EduPagoLike[]): EduCorteDesglose {
  const acc = new Map<string, EduCorteDesgloseRenglon>();

  for (const p of pagos) {
    const method = String(p.method) as EduPaymentMethod;
    const monto = Math.abs(Math.trunc(p.amountCents));
    const r =
      acc.get(method) ??
      { method, count: 0, chargedCents: 0, refundedCents: 0, netCents: 0 };
    r.count += 1;
    if (p.isRefund) r.refundedCents += monto;
    else r.chargedCents += monto;
    r.netCents = r.chargedCents - r.refundedCents;
    acc.set(method, r);
  }

  const conocidos = EDU_PAYMENT_METHODS.filter((m) => acc.has(m)).map((m) => acc.get(m)!);
  const desconocidos = [...acc.keys()]
    .filter((k) => !(EDU_PAYMENT_METHODS as string[]).includes(k))
    .map((k) => acc.get(k)!);
  const renglones = [...conocidos, ...desconocidos];

  return {
    version: EDU_CORTE_DESGLOSE_VERSION,
    renglones,
    netoTotalCents: renglones.reduce((s, r) => s + r.netCents, 0),
  };
}

/**
 * Lee un desglose guardado. Devuelve null si la columna está vacía o si el
 * JSON no tiene la forma esperada.
 *
 * 🔴 NULL NO ES UN ERROR: es un turno cerrado ANTES de esta ola. Todos los
 * que ya están en la base lo son, y la pantalla del corte tiene que poder
 * decir «este corte es anterior al desglose guardado» en vez de reventar o
 * de pintar ceros que parecen datos.
 */
export function eduCorteDesgloseLeer(raw: unknown): EduCorteDesglose | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.renglones)) return null;
  const renglones: EduCorteDesgloseRenglon[] = [];
  for (const r of o.renglones) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.method !== "string") continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
    renglones.push({
      method: x.method as EduPaymentMethod,
      count: num(x.count),
      chargedCents: num(x.chargedCents),
      refundedCents: num(x.refundedCents),
      netCents: num(x.netCents),
    });
  }
  if (renglones.length === 0) return null;
  return {
    version: typeof o.version === "number" ? o.version : 0,
    renglones,
    netoTotalCents:
      typeof o.netoTotalCents === "number"
        ? Math.trunc(o.netoTotalCents)
        : renglones.reduce((s, r) => s + r.netCents, 0),
  };
}

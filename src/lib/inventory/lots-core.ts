// Inventario B (WS1-T5) — lotes, caducidad y consumo FEFO. Las reglas puras,
// sin Prisma, sin fecha del sistema (siempre se inyecta `now`). Lo prueba
// src/lib/inventory/__tests__/lots-core.test.ts.
//
// FEFO = First Expired, First Out: se consume primero el lote que caduca
// antes. Un lote SIN caducidad conocida (expiresAt null — típicamente el
// lote "sin lote" que arrastra las existencias previas a esta migración, o
// stock que entró sin captura de lote) se trata como "caduca al final": se
// consume solo después de agotar todos los lotes con fecha. Así el lote
// "sin lote" funciona también como colchón de reconciliación (ver
// reconcileSinLote en lots.server.ts) sin robarle turno a un lote que sí
// tiene fecha real.

export const ALERT_DAYS_DEFAULT = 30;

export interface LotForFefo {
  id: string;
  expiresAt: Date | null;
  /** Cantidad restante en el lote. Nunca negativa. */
  remaining: number;
}

export interface FefoAllocation {
  lotId: string;
  qty: number;
}

export interface FefoPlan {
  ok: true;
  allocations: FefoAllocation[];
}

export interface FefoInsufficient {
  ok: false;
  /** Lo máximo que se podría consumir hoy sumando todos los lotes. */
  available: number;
}

/** Redondea a 3 decimales para no arrastrar ruido de punto flotante. */
export function round3(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 1000) / 1000;
  return r === 0 ? 0 : r; // normaliza -0 a 0 (evita sorpresas en comparaciones estrictas)
}

function compareForFefo(a: LotForFefo, b: LotForFefo): number {
  if (a.expiresAt === null && b.expiresAt === null) return 0;
  if (a.expiresAt === null) return 1; // null = al final
  if (b.expiresAt === null) return -1;
  return a.expiresAt.getTime() - b.expiresAt.getTime();
}

/**
 * Reparte `qtyNeeded` entre `lots` por FEFO. Si `preferredLotId` viene y ese
 * lote tiene remaining > 0, se consume PRIMERO de ahí (el usuario eligió
 * lote a mano) y el resto sigue el orden FEFO normal. Nunca toca lotes con
 * remaining <= 0. Determinista: mismo input, mismo plan.
 */
export function planFefoConsumption(
  lots: LotForFefo[],
  qtyNeeded: number,
  preferredLotId?: string | null,
): FefoPlan | FefoInsufficient {
  const usable = lots.filter(l => l.remaining > 0);
  const totalAvailable = round3(usable.reduce((s, l) => s + l.remaining, 0));

  if (qtyNeeded <= 0) return { ok: true, allocations: [] };
  if (totalAvailable < qtyNeeded) return { ok: false, available: totalAvailable };

  const ordered = [...usable].sort((a, b) => {
    if (preferredLotId) {
      if (a.id === preferredLotId && b.id !== preferredLotId) return -1;
      if (b.id === preferredLotId && a.id !== preferredLotId) return 1;
    }
    return compareForFefo(a, b);
  });

  let remainingToAllocate = qtyNeeded;
  const allocations: FefoAllocation[] = [];
  for (const lot of ordered) {
    if (remainingToAllocate <= 0) break;
    const take = round3(Math.min(lot.remaining, remainingToAllocate));
    if (take <= 0) continue;
    allocations.push({ lotId: lot.id, qty: take });
    remainingToAllocate = round3(remainingToAllocate - take);
  }

  return { ok: true, allocations };
}

/**
 * Cuánto hay que sumar (o restar) al lote "sin lote" para que la suma de
 * `remaining` de todos los lotes vuelva a cuadrar con `itemQuantity` (el
 * agregado que sigue leyendo el resto del panel). Positivo = faltan
 * unidades en los lotes (alguien subió existencias fuera del sistema de
 * lotes: ajuste manual, una compra de ws1-t4). Negativo = sobran (no
 * debería pasar en operación normal, pero se cubre por si un ajuste manual
 * bajó existencias sin pasar por consumo de lote).
 */
export function reconciliationDelta(itemQuantity: number, lotsSum: number): number {
  return round3(itemQuantity - lotsSum);
}

export function isExpired(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

export function isExpiringSoon(expiresAt: Date | null, now: Date, alertDaysAhead: number): boolean {
  if (!expiresAt) return false;
  if (isExpired(expiresAt, now)) return false;
  const msAhead = alertDaysAhead * 24 * 60 * 60 * 1000;
  return expiresAt.getTime() <= now.getTime() + msAhead;
}

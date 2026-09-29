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

import { fechaCalendarioDe, parseFechaCalendario } from "./fecha-calendario";

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
 *
 * H17 (ws1-t6, decisión de Rafael): si viene `hoy` (día de calendario de la
 * clínica), los lotes CADUCADOS se saltan y no cuentan como disponibles — ni
 * siquiera el elegido a mano. Sin `hoy` (los usos de reconciliación, que solo
 * cuadran números) el comportamiento es el de siempre.
 */
export function planFefoConsumption(
  lots: LotForFefo[],
  qtyNeeded: number,
  preferredLotId?: string | null,
  hoy?: string | null,
): FefoPlan | FefoInsufficient {
  const usable = lots.filter(l => l.remaining > 0 && !(hoy && isExpired(l.expiresAt, hoy)));
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

// ── Caducidad: por DÍA DE CALENDARIO, en la zona de la clínica ────────────
//
// Decisión de Rafael (28-sep-2026), como en las farmacias: un lote que caduca
// el día 1 se puede usar TODO ese día y está «Caducado» a partir del día 2.
//
// Antes se comparaba el instante guardado con el momento actual
// (`expiresAt.getTime() < now.getTime()`), y como la caducidad se guarda a
// medianoche UTC, un lote que caducaba el 1 de septiembre salía «Caducado»
// desde las 18:00 del 31 de agosto (hora de México) y durante todo el día 1.
//
// Aquí no entra ningún reloj: `hoy` es el día de calendario de la clínica
// («2026-09-27», ver `hoyEnZona` en fecha-calendario.ts) y lo calcula quien
// llama. El día de caducidad se lee por sus partes UTC, que acierta con las
// dos formas ya guardadas (00:00Z y 06:00Z).

export type EstadoCaducidad = "ok" | "por_caducar" | "caducado";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function diaUtcEnMs(dia: string | null): number | null {
  const d = parseFechaCalendario(dia);
  return d ? d.getTime() : null;
}

/**
 * Cuántos días de calendario faltan para el día de caducidad: 0 = caduca
 * HOY (todavía se puede usar), negativo = ya pasó. `null` si el lote no
 * tiene caducidad o si `hoy` no es un día válido.
 */
export function diasParaCaducar(expiresAt: Date | null, hoy: string): number | null {
  const caduca = diaUtcEnMs(fechaCalendarioDe(expiresAt));
  const hoyMs = diaUtcEnMs(hoy);
  if (caduca === null || hoyMs === null) return null;
  return Math.round((caduca - hoyMs) / MS_POR_DIA);
}

/** Caducado = su día de caducidad YA PASÓ. El propio día todavía no. */
export function isExpired(expiresAt: Date | null, hoy: string): boolean {
  const dias = diasParaCaducar(expiresAt, hoy);
  return dias !== null && dias < 0;
}

/** Por caducar = no ha caducado y le quedan `alertDaysAhead` días o menos. */
export function isExpiringSoon(expiresAt: Date | null, hoy: string, alertDaysAhead: number): boolean {
  const dias = diasParaCaducar(expiresAt, hoy);
  return dias !== null && dias >= 0 && dias <= alertDaysAhead;
}

export function estadoDeCaducidad(expiresAt: Date | null, hoy: string, alertDaysAhead: number): EstadoCaducidad {
  if (isExpired(expiresAt, hoy)) return "caducado";
  if (isExpiringSoon(expiresAt, hoy, alertDaysAhead)) return "por_caducar";
  return "ok";
}

/** Unidades que quedan en lotes CADUCADOS (con saldo). No son existencias disponibles. */
export function existenciasCaducadas(lots: LotForFefo[], hoy: string): number {
  return round3(lots.filter(l => l.remaining > 0 && isExpired(l.expiresAt, hoy)).reduce((s, l) => s + l.remaining, 0));
}

/** Unidades utilizables hoy: lotes con saldo que NO han caducado. */
export function existenciasVigentes(lots: LotForFefo[], hoy: string): number {
  return round3(lots.filter(l => l.remaining > 0 && !isExpired(l.expiresAt, hoy)).reduce((s, l) => s + l.remaining, 0));
}

/**
 * ¿La caducidad capturada en una compra («AAAA-MM-DD») ya pasó? Mismo criterio
 * que `isExpired`: el propio día de caducidad todavía no. Un texto que no es un
 * día de calendario no cuenta (quien valida el formato es otro).
 */
export function caducidadYaPasada(dia: string | null | undefined, hoy: string): boolean {
  const c = diaUtcEnMs(dia ?? null);
  const h = diaUtcEnMs(hoy);
  return c !== null && h !== null && c < h;
}

// Estado de entrega REAL de un mensaje saliente de WhatsApp.
//
// PROBLEMA QUE RESUELVE: la respuesta del POST a la Graph API solo dice que
// Meta ACEPTÓ el mensaje. Lo que de verdad pasó con él llega después, por el
// webhook, en `entry[].changes[].value.statuses[]` — y el webhook no lo miraba,
// así que la doble palomita del Inbox mentía siempre: pintaba "entregado" para
// todo lo que no hubiera lanzado al enviarse.
//
// Esos status llegan repetidos y fuera de orden (Meta reintenta ante timeouts
// y 5xx), así que aplicarlos a lo bruto es lo que rompería el estado.
//
// PURO a propósito: lo importan el webhook (servidor) y el Inbox (cliente).
// No debe importar prisma, "server-only" ni nada de Node.

export type WaDeliveryStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

export const WA_DELIVERY_STATUSES: readonly WaDeliveryStatus[] = [
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
];

/**
 * Orden de avance. Un status SOLO se aplica si su rango es ESTRICTAMENTE mayor
 * que el actual, y de ahí salen las tres garantías que pide la auditoría:
 *
 *   · idempotente — el mismo status repetido no cambia nada la segunda vez;
 *   · sin retroceso — READ jamás vuelve a DELIVERED (ni DELIVERED a SENT);
 *   · un `sent` que aterriza tarde no borra una entrega ya confirmada.
 *
 * FAILED va entre SENT y DELIVERED, y es una decisión deliberada. Meta manda
 * `failed` EN LUGAR de `delivered`, nunca después (son ramas excluyentes), así
 * que su posición solo decide qué pasa ante un duplicado fuera de orden. Se
 * eligió que no pise a DELIVERED/READ porque esos dos los confirma el teléfono
 * del paciente: son la evidencia más fuerte que hay. Marcar "no llegó" un
 * mensaje que consta como leído sería otra mentira, solo que en el sentido
 * contrario a la que arregla esta auditoría.
 *
 * El caso que de verdad importa —Meta acepta el mensaje y lo rechaza segundos
 * después con 131047— es SENT → FAILED, y ese sí se aplica.
 */
const RANK: Record<WaDeliveryStatus, number> = {
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
  READ: 4,
};

/** Normaliza el `status` crudo de Meta ("sent", "delivered"…). Null si no se reconoce. */
export function parseDeliveryStatus(raw: string | null | undefined): WaDeliveryStatus | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return (WA_DELIVERY_STATUSES as readonly string[]).includes(upper)
    ? (upper as WaDeliveryStatus)
    : null;
}

export interface IncomingDeliveryStatus {
  /** `status` crudo de Meta: "sent" | "delivered" | "read" | "failed". */
  raw: string;
  /** Momento del status (ya resuelto a Date por `metaTimestampToDate`). */
  at: Date;
  /** `errors[0].code` — solo viene en `failed`. */
  errorCode?: number | null;
  /** `errors[0].title`. */
  errorTitle?: string | null;
}

/** Campos a escribir en InboxMessage. Solo se incluyen los que cambian. */
export interface DeliveryPatch {
  deliveryStatus: WaDeliveryStatus;
  deliveredAt?: Date;
  readAt?: Date;
  errorCode?: number | null;
  errorTitle?: string | null;
}

/**
 * Decide qué escribir ante un status entrante, o `null` si NO hay que tocar
 * nada (status desconocido, repetido, o que haría retroceder el estado).
 *
 * `current` es el `deliveryStatus` que ya tiene la fila (null = ninguno).
 */
export function applyDeliveryStatus(
  current: string | null | undefined,
  incoming: IncomingDeliveryStatus,
): DeliveryPatch | null {
  const next = parseDeliveryStatus(incoming.raw);
  if (!next) return null;

  const cur = parseDeliveryStatus(current);
  const curRank = cur ? RANK[cur] : 0;
  if (RANK[next] <= curRank) return null;

  const patch: DeliveryPatch = { deliveryStatus: next };

  if (next === "DELIVERED") {
    patch.deliveredAt = incoming.at;
  }

  if (next === "READ") {
    patch.readAt = incoming.at;
    // Un `read` puede aterrizar sin que el `delivered` haya llegado todavía
    // (webhooks fuera de orden). Leído implica entregado, así que se sella
    // también deliveredAt en vez de dejar "leído" con la entrega en blanco.
    if (!cur || cur === "SENT") patch.deliveredAt = incoming.at;
  }

  if (next === "FAILED") {
    patch.errorCode = incoming.errorCode ?? null;
    patch.errorTitle = incoming.errorTitle ?? null;
  }

  return patch;
}

/**
 * Meta manda el `timestamp` como segundos UNIX en un string. Ante cualquier
 * cosa rara cae al `fallback` (el momento en que se recibió el webhook): más
 * vale un sello aproximado que una fecha de 1970 o un Invalid Date.
 */
export function metaTimestampToDate(ts: unknown, fallback: Date): Date {
  const n =
    typeof ts === "number" ? ts : typeof ts === "string" && ts.trim() !== "" ? Number(ts) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const d = new Date(n * 1000);
  return isNaN(d.getTime()) ? fallback : d;
}

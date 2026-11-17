// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — el aviso de «pedido nuevo» al dueño por WHATSAPP: la
// parte PURA (sin red ni base, client-safe). ws6-t6, 16-nov-2026.
//
// Sale del número de la barbería al WhatsApp que el dueño escribió en
// Configuración → Notificaciones, y SOLO si encendió el interruptor. Nace
// APAGADO (Rafael, 16-nov: «que a ninguna barbería le llegue un cobro de
// Meta que no esperaba»). Un mensaje que inicia el negocio fuera de la
// ventana de 24 h necesita una PLANTILLA aprobada por Meta:
// `dc_barber_pedido_nuevo_dueno` (catálogo de whatsapp-core.ts), que la
// barbería da de alta desde su panel con las demás. Si no está aprobada no
// se manda nada: el correo basta.
//
// Aquí: los parámetros de la plantilla, el texto que sale gratis con la
// ventana abierta, y la decisión de si sale, cómo, o por qué no. Quien habla
// con Meta es notifyBarberOwnerOrder (whatsapp.ts).
// ═══════════════════════════════════════════════════════════════════════
import {
  ORDER_NOTICE_WHATSAPP_KINDS,
  noticeMoney,
  orderPayLabel,
  type OrderNoticeKind,
  type OrderNoticeOrder,
} from "@/lib/barber/pedido-avisos-core";

/**
 * Los tres parámetros de la plantilla `dc_barber_pedido_nuevo_dueno`, EN ORDEN
 * (Meta los sustituye por posición): folio, total y forma de pago.
 */
export function ownerOrderWaParams(order: Pick<OrderNoticeOrder, "folio" | "total" | "payOnline" | "paid">, locale?: string | null): [string, string, string] {
  return [order.folio, noticeMoney(order.total), orderPayLabel(order, locale)];
}

/** Con esto empieza el cuerpo guardado de un aviso al dueño (y el texto libre). */
export const OWNER_ORDER_WA_MARK = "🛍️ Pedido nuevo en tu tienda" as const;
const WA_FOLIO = "Folio: ";
const WA_TOTAL = "Total: ";
const WA_PAY = "Pago: ";
const WA_FOOT = "Revísalo en tu panel: Productos → Pedidos.";

/** Un valor en UN renglón (los renglones son la forma de volver a leerlo). */
const oneLine = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * El texto libre que sale con la ventana de 24 h abierta (gratis), y que
 * además se guarda como cuerpo de la fila: de él se recuperan los parámetros
 * de la plantilla (parseOwnerOrderWaBody) cuando la ventana está cerrada.
 * Un dato por renglón, siempre en el mismo orden.
 */
export function renderOwnerOrderWaText(params: readonly string[]): string {
  return [
    OWNER_ORDER_WA_MARK,
    `${WA_FOLIO}${oneLine(params[0])}`,
    `${WA_TOTAL}${oneLine(params[1])}`,
    `${WA_PAY}${oneLine(params[2])}`,
    WA_FOOT,
  ].join("\n");
}

/** Del cuerpo guardado a [folio, total, forma de pago]; null si no es un aviso de éstos. */
export function parseOwnerOrderWaBody(body: string | null | undefined): [string, string, string] | null {
  const lines = String(body ?? "").split("\n");
  if (lines.length !== 5 || lines[0] !== OWNER_ORDER_WA_MARK) return null;
  if (!lines[1].startsWith(WA_FOLIO) || !lines[2].startsWith(WA_TOTAL) || !lines[3].startsWith(WA_PAY)) return null;
  const folio = lines[1].slice(WA_FOLIO.length).trim();
  const total = lines[2].slice(WA_TOTAL.length).trim();
  const pay = lines[3].slice(WA_PAY.length).trim();
  return folio && total && pay ? [folio, total, pay] : null;
}

export type OwnerWaSkipReason = "off" | "kind" | "noPhone" | "notConnected" | "samePhone" | "templateNotApproved" | "noQuota";

/**
 * Qué se hace. Una sola forma (sin unión discriminada): el repo no compila en
 * `strict` y TS no estrecharía por `send`. `reason` solo viene cuando no sale.
 */
export interface OwnerWaDecision {
  send: "text" | "template" | null;
  reason?: OwnerWaSkipReason;
}

/**
 * ¿Sale el WhatsApp al dueño, y cómo? En este orden:
 *   1. interruptor apagado                         → no
 *   2. este motivo no se avisa por WhatsApp (PAID)  → no
 *   3. sin WhatsApp del dueño                       → no
 *   4. la barbería no tiene su WhatsApp conectado   → no
 *   5. el número del dueño ES el de la barbería     → no (Meta no manda a sí mismo)
 *   6. sin mensajes en el cupo del plan             → no
 *   7. el dueño escribió en las últimas 24 h        → TEXTO libre (gratis)
 *   8. plantilla APROBADA                           → PLANTILLA (Meta la cobra)
 *   9. si no                                        → no (el correo basta)
 */
export function decideOwnerWa(f: {
  enabled: boolean;
  kind: OrderNoticeKind;
  ownerPhone: string | null;
  connected: boolean;
  /** Teléfono público de la barbería (10 dígitos), para no mandarse a sí misma. */
  shopPhone: string | null;
  hasQuota: boolean;
  windowOpen: boolean;
  /** Estado de la plantilla en Meta (APPROVED, PENDING, MISSING…), null si no se pudo leer. */
  templateStatus: string | null;
}): OwnerWaDecision {
  if (!f.enabled) return { send: null, reason: "off" };
  if (!ORDER_NOTICE_WHATSAPP_KINDS.includes(f.kind)) return { send: null, reason: "kind" };
  if (!f.ownerPhone) return { send: null, reason: "noPhone" };
  if (!f.connected) return { send: null, reason: "notConnected" };
  if (f.shopPhone && f.shopPhone === f.ownerPhone) return { send: null, reason: "samePhone" };
  if (!f.hasQuota) return { send: null, reason: "noQuota" };
  if (f.windowOpen) return { send: "text" };
  if (String(f.templateStatus ?? "").toUpperCase() === "APPROVED") return { send: "template" };
  return { send: null, reason: "templateNotApproved" };
}


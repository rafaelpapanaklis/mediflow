import "server-only";
import type { OrderItem } from "@/lib/barber/tienda-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — «ENTRÓ UN PEDIDO NUEVO A LA TIENDA»: el punto ÚNICO.
 *
 * 16-nov-2026. Rafael preguntó dónde le llega al dueño un pedido de la
 * tienda. Dentro del panel ya se entera (numerito del menú, pestaña Pedidos
 * y tarjeta de Inicio). Falta decidir si además se le manda un CORREO: esa
 * decisión es de Rafael y todavía no la toma.
 *
 * Por eso esto está PREPARADO Y APAGADO:
 *   · HOY NO MANDA NADA. Ni correo, ni WhatsApp, ni push. Con
 *     TIENDA_OWNER_EMAIL_ENABLED en false, `sendOwnerEmail` ni se llama.
 *   · La ruta pública que crea el pedido (POST
 *     /api/barber/public/tienda/[slug]/pedidos) llama a
 *     onTiendaOrderCreated UNA vez, después de guardar el pedido. Es el único
 *     sitio que lo llama y el único donde nace un pedido.
 *   · NUNCA lanza: si un aviso falla, el cliente ya apartó y recibe su folio.
 *
 * Para encender el correo cuando Rafael lo decida (y solo entonces):
 *   1. escribir `sendOwnerEmail` (a quién: ¿el dueño de la cadena, el de la
 *      sede, todos los que tengan products.view?; con qué texto; con qué
 *      proveedor — el repo ya manda correo en otras partes: reutilizarlo);
 *   2. poner TIENDA_OWNER_EMAIL_ENABLED en true;
 *   3. si el envío tarda, sacarlo de la respuesta con `after()` de
 *      next/server en la ruta (hoy se espera porque no hace nada).
 * Si además se quiere avisar cuando el pedido se PAGA en línea, ese momento
 * vive en el webhook de Mercado Pago (ws6-t5), no aquí.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Interruptor del correo al dueño por pedido nuevo. DECISIÓN DE RAFAEL: apagado. */
export const TIENDA_OWNER_EMAIL_ENABLED = false;

/** Lo que se sabe del pedido en el momento en que nace (sin leer la base otra vez). */
export interface NewTiendaOrderEvent {
  orderId: string;
  folio: string;
  /** Sede dueña de las existencias: la que recibe y entrega el pedido. */
  barbershopId: string;
  /** Slug de la tienda por la que entró (para armar ligas al panel o a la tienda). */
  shopSlug: string;
  shopName: string;
  branchName: string | null;
  clientName: string;
  clientPhone: string;
  items: OrderItem[];
  total: number;
  /** El cliente eligió «Pagar ahora en línea» (todavía NO está pagado: eso lo marca Mercado Pago). */
  payOnline: boolean;
  /** Hasta cuándo se aparta si no se paga ni se recoge (ISO). */
  expiresAt: string;
}

/** Un canal de aviso: su nombre, si está encendido y cómo manda. */
export interface OrderNoticeChannel {
  name: string;
  enabled: () => boolean;
  send: (ev: NewTiendaOrderEvent) => Promise<void>;
}

/**
 * Correo al dueño. SIN IMPLEMENTAR A PROPÓSITO (ver arriba). Si alguien
 * enciende el interruptor sin escribirlo, falla aquí, queda en el log y el
 * pedido del cliente sigue adelante.
 */
async function sendOwnerEmail(_ev: NewTiendaOrderEvent): Promise<void> {
  throw new Error("correo al dueño por pedido nuevo: sin implementar (decisión de Rafael pendiente)");
}

/** Los canales que existen. Hoy uno, y apagado. */
export const ORDER_NOTICE_CHANNELS: readonly OrderNoticeChannel[] = [
  { name: "correo-dueno", enabled: () => TIENDA_OWNER_EMAIL_ENABLED, send: sendOwnerEmail },
];

/**
 * Se llama UNA vez por pedido recién creado. Devuelve los canales que sí
 * avisaron (hoy, ninguno). Nunca lanza.
 */
export async function onTiendaOrderCreated(
  ev: NewTiendaOrderEvent,
  channels: readonly OrderNoticeChannel[] = ORDER_NOTICE_CHANNELS,
): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  for (const ch of channels) {
    try {
      if (!ch.enabled()) continue;
      await ch.send(ev);
      sent.push(ch.name);
    } catch (e) {
      console.warn(`[barber/tienda] aviso de pedido nuevo (${ch.name}) falló:`, (e as Error)?.message ?? e);
    }
  }
  return { sent };
}

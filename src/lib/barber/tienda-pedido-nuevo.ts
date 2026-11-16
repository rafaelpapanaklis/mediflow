import "server-only";
import * as nextServer from "next/server";
import type { OrderItem } from "@/lib/barber/tienda-core";
import type { OrderNoticeKind } from "@/lib/barber/pedido-avisos-core";
import { notifyOwnerOfOrder, type OrderNoticeResult } from "@/lib/barber/pedido-avisos";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — «ENTRÓ UN PEDIDO A LA TIENDA» y «SE PAGÓ EN LÍNEA»:
 * los DOS únicos puntos desde los que se le avisa al dueño.
 *
 * 16-nov-2026. Dentro del panel el dueño ya se entera (numerito del menú,
 * pestaña Pedidos y tarjeta de Inicio). Además, por decisión de Rafael
 * («haz el 1, 2, 3 y 4»), se le avisa por CORREO y, si lo enciende, por
 * WHATSAPP. Quién manda, a quién y la regla de «una sola vez por pedido»
 * viven en pedido-avisos.ts; aquí solo están los dos momentos:
 *
 *   · onTiendaOrderCreated — lo llama UNA vez la ruta pública que crea el
 *     pedido (POST /api/barber/public/tienda/[slug]/pedidos), después de
 *     guardarlo. Es el único sitio donde nace un pedido.
 *   · onTiendaOrderPaid — lo llama el webhook de Mercado Pago cuando
 *     aplicarPagoDePedido marca el pedido como pagado (pasa una sola vez).
 *
 * Los dos NUNCA lanzan, y las rutas los corren con afterResponse: DESPUÉS de
 * contestarle al cliente (o a Mercado Pago). Un correo lento o caído no
 * retrasa ni tumba el pedido.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Lo que se sabe del pedido en el momento en que nace. */
export interface NewTiendaOrderEvent {
  orderId: string;
  folio: string;
  /** Sede dueña de las existencias: la que recibe y entrega el pedido. */
  barbershopId: string;
  /** Slug de la tienda por la que entró. */
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

/** Quien de verdad avisa. Se puede cambiar en las pruebas (nunca se manda nada real ahí). */
export type OwnerNotifier = (kind: OrderNoticeKind, orderId: string) => Promise<OrderNoticeResult>;

const VACIO: OrderNoticeResult = { ran: false, reason: "error", channels: [] };

async function avisar(kind: OrderNoticeKind, orderId: string, notify: OwnerNotifier): Promise<OrderNoticeResult> {
  try {
    if (!orderId) return { ran: false, reason: "sin_pedido", channels: [] };
    return await notify(kind, orderId);
  } catch (e) {
    console.warn(`[barber/tienda] aviso al dueño (${kind} ${orderId}) falló:`, (e as Error)?.message ?? e);
    return VACIO;
  }
}

/** Se llama UNA vez por pedido recién creado. Nunca lanza. */
export function onTiendaOrderCreated(ev: NewTiendaOrderEvent, notify: OwnerNotifier = notifyOwnerOfOrder): Promise<OrderNoticeResult> {
  return avisar("NEW", ev?.orderId, notify);
}

/** Se llama cuando Mercado Pago confirma el pago de un pedido. Nunca lanza. */
export function onTiendaOrderPaid(orderId: string, notify: OwnerNotifier = notifyOwnerOfOrder): Promise<OrderNoticeResult> {
  return avisar("PAID", orderId, notify);
}

/**
 * Corre `tarea` DESPUÉS de mandar la respuesta (after de next/server): el
 * cliente recibe su folio sin esperar al correo. Fuera de una petición de
 * Next (pruebas, scripts) `after` no existe: ahí se lanza sin esperarla.
 * Nunca lanza y nunca deja una promesa rechazada suelta.
 */
export function afterResponse(tarea: () => Promise<unknown>): void {
  const segura = async () => {
    try {
      await tarea();
    } catch (e) {
      console.warn("[barber/tienda] tarea posterior a la respuesta falló:", (e as Error)?.message ?? e);
    }
  };
  // Por el espacio de nombres y no con `import { after }`: Next 16 (el que
  // corre en producción) lo exporta, pero una copia vieja de node_modules no,
  // y ahí un import con nombre ni compila. Si no existe o no hay petición en
  // curso (lanza), se corre sin esperarla.
  const after = (nextServer as unknown as { after?: (fn: () => Promise<void>) => void }).after;
  try {
    if (typeof after !== "function") throw new Error("sin after");
    after(segura);
  } catch {
    void segura();
  }
}

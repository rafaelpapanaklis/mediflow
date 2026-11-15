// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — Mercado Pago de la tienda: las REGLAS (ws6-t5).
//
// PURO: sin base, sin red, sin Next. Aquí se decide
//   · con qué renglones y por cuánto se arma la preferencia de un pedido;
//   · si un pago que Mercado Pago dice «aprobado» marca el pedido o no;
//   · la comisión de DaleControl (construida, en 0 %, igual que el dental);
//   · la cookie que ata la ida y vuelta del OAuth.
// El servidor (mercadopago.ts) solo lee, escribe y llama a Mercado Pago.
//
// Modelo (el mismo del dental, src/lib/anticipos/*): la barbería conecta SU
// cuenta por OAuth con la aplicación de DaleControl; el dinero va directo a
// ella. Del dental se REUTILIZA (solo lectura) el cliente HTTP de Mercado
// Pago, el OAuth, la firma del webhook y la fórmula de la comisión; las
// tablas, las rutas y la cookie son propias de barber.
// ═══════════════════════════════════════════════════════════════════════

import { calcularComision, type ModoComision } from "@/lib/anticipos/core";

// ── Rutas y cookie (propias de barber; las del dental no se tocan) ──────

/** La «Redirect URL» que Rafael registra en la aplicación de Mercado Pago. */
export const BARBER_MP_CALLBACK_PATH = "/api/barber/mercadopago/oauth/callback";
export const BARBER_MP_CONNECT_PATH = "/api/barber/mercadopago/oauth/conectar";
export const BARBER_MP_WEBHOOK_PATH = "/api/barber/mercadopago/webhook";
/** Pantalla a la que vuelve el OAuth (Configuración, tarjeta «Pagos en línea»). */
export const BARBER_MP_SETTINGS_PATH = "/barber/configuracion";

export const BARBER_MP_COOKIE = "dcb_mp_oauth";
export const BARBER_MP_COOKIE_PATH = "/api/barber/mercadopago/oauth";
export const BARBER_MP_COOKIE_MAX_AGE_S = 600;

/** Variables de entorno que la función necesita (las mismas del dental). */
export const BARBER_MP_ENV = [
  "MERCADOPAGO_CLIENT_ID",
  "MERCADOPAGO_CLIENT_SECRET",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "DATA_ENCRYPTION_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

// ── Pedido (contrato con ws6-t1, sql/barber_tienda.sql) ─────────────────

/**
 * Horas que vive un pedido apartado. El contrato con la tienda dice 72 h; el
 * link de pago vence a la misma hora que el pedido (created_at + esto).
 */
export const BARBER_ORDER_HOLD_HOURS = 72;

/**
 * Menor pedido que se ofrece pagar en línea, en pesos. Mismo piso que el
 * dental (ANTICIPO_MINIMO_MXN / link de factura): por debajo, Mercado Pago se
 * come casi todo en comisión y el cliente paga al recoger.
 */
export const BARBER_MP_MIN_ORDER_MXN = 10;

/** Tipos de pago que NO se ofrecen: OXXO y transferencia tardan horas o días. */
export const BARBER_MP_EXCLUDED_PAYMENT_TYPES = ["ticket", "atm"] as const;

export type EstadoPedido = "PENDING" | "PAID_ONLINE" | "READY" | "PICKED_UP" | "CANCELLED" | "EXPIRED";

export interface PedidoParaCobrar {
  id: string;
  status: string;
  total: number;
  items: unknown;
  createdAt: Date;
}

export interface ItemPreferencia {
  title: string;
  quantity: number;
  unit_price: number;
}

export function aCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

export function venceElPedido(createdAt: Date): Date {
  return new Date(createdAt.getTime() + BARBER_ORDER_HOLD_HOURS * 60 * 60 * 1000);
}

export type MotivoSinCobro = "no_pendiente" | "vencido" | "renglones" | "bajo_minimo";

/**
 * Los renglones de la preferencia, a precio CONGELADO (el del pedido, no el
 * del catálogo de hoy). La suma tiene que dar EXACTAMENTE el total del
 * pedido, al centavo: si no, el pedido está roto y no se cobra en línea
 * (cobrar otra cifra que la que vio el cliente es peor que no ofrecerlo).
 */
export function renglonesDelPedido(
  items: unknown,
  total: number,
): { ok: true; items: ItemPreferencia[] } | { ok: false } {
  if (!Array.isArray(items) || items.length === 0) return { ok: false };
  const out: ItemPreferencia[] = [];
  let suma = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return { ok: false };
    const it = raw as Record<string, unknown>;
    const name = typeof it.name === "string" ? it.name.trim() : "";
    const unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : Number(it.unitPrice);
    const qty = typeof it.qty === "number" ? it.qty : Number(it.qty);
    if (!name || !Number.isFinite(unitPrice) || unitPrice <= 0) return { ok: false };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false };
    suma += aCentavos(unitPrice) * qty;
    out.push({ title: name.slice(0, 250), quantity: qty, unit_price: aCentavos(unitPrice) / 100 });
  }
  if (!Number.isFinite(total) || suma !== aCentavos(total)) return { ok: false };
  return { ok: true, items: out };
}

/** ¿Se puede pedir el link de pago de este pedido ahora? null = sí. */
export function motivoSinCobro(p: PedidoParaCobrar, ahora: Date): MotivoSinCobro | null {
  if (p.status !== "PENDING") return "no_pendiente";
  if (venceElPedido(p.createdAt).getTime() <= ahora.getTime()) return "vencido";
  if (!renglonesDelPedido(p.items, p.total).ok) return "renglones";
  if (aCentavos(p.total) < aCentavos(BARBER_MP_MIN_ORDER_MXN)) return "bajo_minimo";
  return null;
}

// ── Comisión de DaleControl (igual que el dental: construida, en 0) ─────

/**
 * La comisión en PESOS para `marketplace_fee`. Usa la MISMA fórmula del
 * dental (calcularComision). En 0 —como sale de fábrica— no se manda nada.
 * Si la comisión se come el pedido entero, no se cobra comisión (0) en vez de
 * dejar al cliente sin pagar.
 */
export function comisionDelPedido(modo: string, valor: number, total: number): number {
  const m: ModoComision = modo === "percent" ? "percent" : "fixed";
  return calcularComision(m, valor, total) ?? 0;
}

// ── El pago que avisa el webhook ────────────────────────────────────────

export interface PedidoParaPago {
  id: string;
  status: string;
  total: number;
  mpPaymentId: string | null;
  paidAt: Date | null;
}

/** Lo que el webhook sabe del pago tras RELEERLO en Mercado Pago (nada del cuerpo). */
export interface PagoLeido {
  id: string;
  status: string;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  collectorId: string | null;
}

export type DecisionPago =
  /** Se marca: status → PAID_ONLINE (si estaba PENDING), paid_at, mp_payment_id. */
  | { accion: "marcar"; nuevoEstado: "PAID_ONLINE" | "READY" }
  /** Este mismo pago ya marcó este pedido: no se hace nada (idempotente). */
  | { accion: "ya_marcado" }
  | { accion: "ignorar"; motivo: string };

/**
 * ¿Este pago marca este pedido? Exige, en este orden:
 *   1. external_reference == id del pedido (el pago es DE este pedido);
 *   2. lo cobró la cuenta conectada de la barbería (collector_id);
 *   3. aprobado;
 *   4. en MXN y por EXACTAMENTE el total del pedido, al centavo;
 *   5. el pedido sigue esperando su pago: PENDING, o READY sin pagar (la
 *      barbería lo dejó listo mientras el cliente pagaba).
 * Un pedido VENCIDO, CANCELADO o ENTREGADO no se revive ni se toca: el
 * dinero está en la cuenta de la barbería y se devuelve desde Mercado Pago.
 */
export function evaluarPagoDePedido(
  pedido: PedidoParaPago,
  pago: PagoLeido,
  cuentaDeLaBarberia: string | null,
): DecisionPago {
  if (pago.externalReference !== pedido.id) {
    return { accion: "ignorar", motivo: "la referencia del pago no es este pedido" };
  }
  if (cuentaDeLaBarberia && pago.collectorId && pago.collectorId !== cuentaDeLaBarberia) {
    return { accion: "ignorar", motivo: "el pago lo cobró otra cuenta de Mercado Pago" };
  }
  if (pago.status !== "approved") {
    return { accion: "ignorar", motivo: `pago ${pago.status || "sin estado"}` };
  }
  if (pago.currencyId !== "MXN") {
    return { accion: "ignorar", motivo: `moneda ${pago.currencyId ?? "?"}, no MXN` };
  }
  if (pago.transactionAmount == null || aCentavos(pago.transactionAmount) !== aCentavos(pedido.total)) {
    return {
      accion: "ignorar",
      motivo: `importe ${pago.transactionAmount ?? "?"} distinto del total ${pedido.total}`,
    };
  }
  if (pedido.mpPaymentId === pago.id) return { accion: "ya_marcado" };
  if (pedido.mpPaymentId || pedido.paidAt) {
    return { accion: "ignorar", motivo: `el pedido ya tiene otro pago (${pedido.mpPaymentId ?? "pagado"}): revisar y devolver` };
  }
  if (pedido.status === "PENDING") return { accion: "marcar", nuevoEstado: "PAID_ONLINE" };
  if (pedido.status === "READY") return { accion: "marcar", nuevoEstado: "READY" };
  return { accion: "ignorar", motivo: `pedido ${pedido.status}: no se marca; el pago se devuelve desde Mercado Pago` };
}

// ── La cookie del OAuth (copia del molde del dental, con barbería) ──────

export interface IdaOAuthBarber {
  state: string;
  verifier: string;
  /** Matriz de la cadena que se está conectando. */
  barbershopId: string;
  /** barber_users.id de quien salió a Mercado Pago. */
  barberUserId: string;
}

export function empacarIdaBarber(ida: IdaOAuthBarber): string {
  return Buffer.from(JSON.stringify(ida), "utf8").toString("base64url");
}

export function desempacarIdaBarber(valor: string | null | undefined): IdaOAuthBarber | null {
  if (!valor) return null;
  try {
    const o = JSON.parse(Buffer.from(valor, "base64url").toString("utf8")) as Partial<IdaOAuthBarber>;
    if (
      typeof o.state === "string" && o.state &&
      typeof o.verifier === "string" && o.verifier &&
      typeof o.barbershopId === "string" && o.barbershopId &&
      typeof o.barberUserId === "string" && o.barberUserId
    ) {
      return { state: o.state, verifier: o.verifier, barbershopId: o.barbershopId, barberUserId: o.barberUserId };
    }
  } catch {
    /* cookie rota = sin ida */
  }
  return null;
}

// ── Quién conecta ───────────────────────────────────────────────────────

interface ShopRef {
  id: string;
  parentId: string | null;
}

/**
 * Solo el DUEÑO de la cadena conecta o desconecta la cuenta: rol OWNER y su
 * sede PROPIA es la matriz. Devuelve el id de la matriz (la fila de la
 * conexión), o null si esta persona no puede. La sede que esté operando en
 * el selector no cuenta: la cuenta es de la cadena.
 */
export function matrizDelDueno(ctx: {
  role: string;
  barbershop: ShopRef;
  homeBarbershop?: ShopRef;
}): string | null {
  if (ctx.role !== "OWNER") return null;
  const propia = ctx.homeBarbershop ?? ctx.barbershop;
  if (!propia?.id || propia.parentId) return null;
  return propia.id;
}

/** Matriz de la cadena que opera una sesión cualquiera del panel (para leer el estado). */
export function matrizDeLaSesion(ctx: { barbershopId: string; barbershop: ShopRef }): string {
  return ctx.barbershop.parentId ?? ctx.barbershopId;
}

// ── Vuelta del checkout ─────────────────────────────────────────────────

/** Página del folio a la que vuelve el cliente si la tienda no manda otra. */
export function rutaDelFolio(slug: string, orderId: string): string {
  return `/b/${encodeURIComponent(slug)}/tienda/pedido/${encodeURIComponent(orderId)}`;
}

/**
 * La tienda puede pedir otra página de vuelta, pero SOLO dentro de la página
 * de ESA barbería (`/b/<slug>/…`), relativa y sin trucos: nunca una URL de
 * fuera (un link de pago no puede servir para mandar a alguien a otro sitio).
 */
export function vueltaSegura(slug: string, orderId: string, pedida: unknown): string {
  const porDefecto = rutaDelFolio(slug, orderId);
  if (typeof pedida !== "string") return porDefecto;
  const p = pedida.trim();
  const prefijo = `/b/${encodeURIComponent(slug)}/`;
  if (!p.startsWith(prefijo) || p.length > 300) return porDefecto;
  if (p.includes("//") || p.includes("\\") || p.includes("..") || /[\s\u0000-\u001f]/.test(p)) return porDefecto;
  return p;
}

/** user_id de MP enmascarado («••••1234»), para distinguir cuentas sin exponerlo. */
export function enmascararCuenta(id: string | null | undefined): string | null {
  if (!id) return null;
  return `••••${id.slice(-4)}`;
}

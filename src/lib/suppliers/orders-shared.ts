// Lógica de pedidos compartida entre el panel de proveedor (server + client).
// Módulo PURO (solo importa tipos union de `types.ts`) → seguro de importar
// tanto desde route handlers como desde componentes "use client".

import type { SupplierOrderStatus, SupplierPaymentStatus } from "@/lib/suppliers/types";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// Máquina de estados del ciclo de vida de un pedido. Es la ÚNICA fuente de
// verdad de las transiciones permitidas: la valida la API (PATCH) y la usa la
// UI para decidir qué botones de acción mostrar.
export const ORDER_STATUS_FLOW: Record<SupplierOrderStatus, SupplierOrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: SupplierOrderStatus, to: SupplierOrderStatus): boolean {
  return ORDER_STATUS_FLOW[from]?.includes(to) ?? false;
}

// Etiqueta del botón que dispara cada transición (orientada a la acción, a
// diferencia de SUPPLIER_ORDER_STATUS_LABELS que nombra el estado).
export const STATUS_ACTION_LABELS: Record<SupplierOrderStatus, string> = {
  PENDING: "Marcar como pendiente",
  CONFIRMED: "Confirmar pedido",
  SHIPPED: "Marcar como enviado",
  DELIVERED: "Marcar como entregado",
  CANCELLED: "Cancelar pedido",
};

export const ORDER_STATUS_TONE: Record<SupplierOrderStatus, Tone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  SHIPPED: "brand",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export const PAYMENT_STATUS_TONE: Record<SupplierPaymentStatus, Tone> = {
  UNPAID: "warning",
  PAID: "success",
};

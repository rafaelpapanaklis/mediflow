// Lógica de pedidos de laboratorio compartida entre server + client.
// Módulo PURO (solo importa tipos union desde `types.ts`) → seguro de importar
// tanto desde route handlers como desde componentes "use client".

import {
  DENTAL_LAB_ORDER_FLOW,
  type DentalLabOrderStatus,
} from "@/lib/laboratorios/types";

// Máquina de estados del ciclo de vida de una orden derivada del flujo
// canónico DENTAL_LAB_ORDER_FLOW. Es la ÚNICA fuente de verdad de las
// transiciones permitidas: la valida la API (PUT estatus) y la usa la UI para
// decidir qué botones de acción mostrar.
//
// Reglas:
//   - Solo se avanza al siguiente paso del flujo (SOLICITADA → RECIBIDA → …).
//   - CANCELADA está permitida desde cualquier estado NO terminal.
//   - ENTREGADA y CANCELADA son terminales (sin transiciones salientes).
export const DENTAL_LAB_ORDER_STATUS_FLOW: Record<
  DentalLabOrderStatus,
  DentalLabOrderStatus[]
> = (() => {
  const map: Record<DentalLabOrderStatus, DentalLabOrderStatus[]> = {
    SOLICITADA: [],
    RECIBIDA: [],
    ATENDIENDO: [],
    ENVIADA: [],
    ENTREGADA: [],
    CANCELADA: [],
  };
  for (let i = 0; i < DENTAL_LAB_ORDER_FLOW.length - 1; i++) {
    const from = DENTAL_LAB_ORDER_FLOW[i];
    const to = DENTAL_LAB_ORDER_FLOW[i + 1];
    map[from] = [to, "CANCELADA"];
  }
  // ENTREGADA es terminal; CANCELADA también.
  map.ENTREGADA = [];
  map.CANCELADA = [];
  return map;
})();

/** ¿Es válida la transición `from` → `to` según el flujo canónico? */
export function canTransition(
  from: DentalLabOrderStatus,
  to: DentalLabOrderStatus
): boolean {
  return DENTAL_LAB_ORDER_STATUS_FLOW[from]?.includes(to) ?? false;
}

/** Estados a los que se puede avanzar desde `from` (incluye CANCELADA). */
export function nextLabStatuses(
  from: DentalLabOrderStatus
): DentalLabOrderStatus[] {
  return [...(DENTAL_LAB_ORDER_STATUS_FLOW[from] ?? [])];
}

/** Etiqueta de acción del botón que dispara cada transición (es-MX). */
export const DENTAL_LAB_STATUS_ACTION_LABELS: Record<
  DentalLabOrderStatus,
  string
> = {
  SOLICITADA: "Marcar como solicitada",
  RECIBIDA: "Confirmar recepción",
  ATENDIENDO: "Iniciar trabajo",
  ENVIADA: "Marcar como enviada",
  ENTREGADA: "Confirmar entrega",
  CANCELADA: "Cancelar orden",
};

export function isTerminalLabStatus(status: DentalLabOrderStatus): boolean {
  return status === "ENTREGADA" || status === "CANCELADA";
}

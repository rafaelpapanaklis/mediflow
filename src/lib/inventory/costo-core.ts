// Inventario A (WS1-T4) — costo unitario y valor real. Reglas puras, sin
// Prisma. Lo prueba src/lib/inventory/__tests__/costo-core.test.ts.
//
// `unitCost` es lo que a la clínica le CUESTA cada unidad, separado de
// `price` (precio de venta, sin uso hoy). 0 es un valor válido ("no cuesta
// nada") y se distingue de "no lo hemos medido": eso lo decide el caller
// (null/undefined no llega aquí, se resuelve a 0 antes).

export interface ItemConCosto {
  unitCost: number;
  quantity: number;
}

/** Σ unitCost × quantity — el "Valor total" del inventario. */
export function sumarValorInventario(items: ItemConCosto[]): number {
  return items.reduce((s, i) => s + i.unitCost * i.quantity, 0);
}

export interface LineaCompra {
  quantity: number;
  unitCost: number;
}

/**
 * Valida una línea de compra (entrada de inventario). null = válida.
 * Cantidad tiene que ser un entero positivo (InventoryItem.quantity sigue
 * siendo Int hoy — decimales son de ws1-t5) y el costo no puede ser negativo
 * (0 sí: "me lo regalaron").
 */
export function validarLineaCompra(line: LineaCompra): string | null {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    return "La cantidad debe ser un entero mayor a 0.";
  }
  if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
    return "El costo unitario no puede ser negativo.";
  }
  return null;
}

/** Σ quantity × unitCost de las líneas — el monto del gasto "Insumos". */
export function montoTotalCompra(lines: LineaCompra[]): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
}

/**
 * Descuento de insumo (alta de sesión de tratamiento / compra manual).
 * null = válido. Cierra el bug de qty negativa "subiendo" el stock (un
 * decrement con delta negativo es un increment) y el de exceder lo
 * disponible. disponible/pedida en las mismas unidades (InventoryItem.quantity).
 */
export function validarDescuentoInsumo(disponible: number, pedida: number): string | null {
  if (!Number.isFinite(pedida) || pedida <= 0) {
    return "La cantidad a descontar debe ser mayor a 0.";
  }
  if (disponible < pedida) {
    return `Stock insuficiente: disponible ${disponible}, necesitas ${pedida}.`;
  }
  return null;
}

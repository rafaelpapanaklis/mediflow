// El aviso antes de borrar un gasto (ws1-t2, auditoría de uso C-35). Puro,
// sin React (src/lib/finanzas/__tests__/aviso-borrar-gasto.test.ts).
//
// Borrar usaba el `confirm()` del navegador («¿Eliminar este gasto?») y no
// decía qué pasaba después. El borrado es LÓGICO: el gasto deja de contar en
// los gastos y la utilidad, y queda en Movimientos (la bitácora) con quién lo
// borró y una copia de sus datos (lib/gastos-borrado.server). Ahora el diálogo
// del panel lo dice, y nombra el gasto que se va a borrar.

export interface GastoParaAviso {
  category: string;
  amount: number;
  /** El gasto nació de una compra de inventario. */
  purchaseId?: string | null;
}

export interface AvisoBorrarGasto {
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
}

function monto(n: number, idioma: "es" | "en"): string {
  return new Intl.NumberFormat(idioma === "en" ? "en-US" : "es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(n || 0);
}

export function avisoBorrarGasto(g: GastoParaAviso | null | undefined, idioma: "es" | "en" = "es"): AvisoBorrarGasto {
  const en = idioma === "en";
  const cual = g ? (en ? ` «${g.category}» of ${monto(g.amount, idioma)}` : ` «${g.category}» de ${monto(g.amount, idioma)}`) : "";
  const base = en
    ? "It stops counting in expenses and profit. It stays in Activity (the audit log) with who deleted it and a copy of its data."
    : "Deja de contar en los gastos y en la utilidad. Queda en Movimientos (la bitácora) con quién lo borró y una copia de sus datos.";
  const compra = g?.purchaseId
    ? en
      ? " This expense comes from an inventory purchase: deleting it does NOT reverse that purchase's stock or cost, so Finance and Inventory will stop matching."
      : " Este gasto viene de una compra de inventario: borrarlo NO revierte las existencias ni el costo de esa compra, y Finanzas e Inventario dejarán de cuadrar."
    : "";
  return {
    title: en ? `Delete the expense${cual}?` : `¿Eliminar el gasto${cual}?`,
    description: base + compra,
    confirmText: en ? "Delete expense" : "Eliminar gasto",
    cancelText: en ? "Keep it" : "No, dejarlo",
  };
}

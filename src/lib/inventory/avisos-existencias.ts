// Avisos de existencias en «Hoy» (ws1-t5). Regla pura, sin Prisma. Lo prueba
// __tests__/avisos-existencias.test.ts.
//
// Por qué existe: «Hoy» decía «Inventario crítico: 109 insumos bajo nivel»
// contando `quantity <= minQuantity`, que mete en el mismo saco lo AGOTADO
// (0 existencias) y lo que está BAJO (queda algo, pero menos del mínimo).
// Inventario, en cambio, los separa: «108 agotados» y «1 en stock bajo». Las
// dos pantallas decían lo mismo con palabras que no casaban, y el aviso
// llevaba a un filtro («Stock bajo») donde solo aparecía 1 de los 109.
//
// Mismo criterio que `getStatus()` de la pantalla de Inventario:
//   agotado = sin existencias          → filtro «Agotados»
//   bajo    = queda algo, ≤ el mínimo  → filtro «Stock bajo»

import type { HomeAdminAlert } from "@/lib/home/types";

export interface ConteoExistencias {
  /** Artículos sin existencias (`quantity <= 0`). */
  agotados: number;
  /** Artículos con existencias, pero en el mínimo o por debajo. */
  bajos: number;
}

function entero(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Un aviso por cada cosa que pasa, cada uno con SU filtro. Primero lo
 * agotado (peligro: ya no hay), después lo bajo (alerta: hay que pedir).
 * Sin nada que decir, ningún aviso.
 */
export function avisosDeExistencias(conteo: ConteoExistencias): HomeAdminAlert[] {
  const agotados = entero(conteo.agotados);
  const bajos = entero(conteo.bajos);
  const avisos: HomeAdminAlert[] = [];
  if (agotados > 0) {
    avisos.push({
      id: "inv-out",
      tone: "danger",
      title: `Inventario: ${agotados} insumo${agotados === 1 ? "" : "s"} agotado${agotados === 1 ? "" : "s"}`,
      href: "/dashboard/inventory?filter=out",
    });
  }
  if (bajos > 0) {
    avisos.push({
      id: "inv-low",
      tone: "warning",
      title: `Inventario: ${bajos} insumo${bajos === 1 ? "" : "s"} con stock bajo`,
      href: "/dashboard/inventory?filter=low",
    });
  }
  return avisos;
}

/** `?filter=…` del aviso → el filtro de la pantalla de Inventario. */
export function filtroDeInventario(param: string | null | undefined): "poco" | "sin" | "por_caducar" | "caducado" | null {
  switch (param) {
    case "low": return "poco";
    case "out": return "sin";
    case "por-caducar": return "por_caducar";
    case "caducado": return "caducado";
    default: return null;
  }
}

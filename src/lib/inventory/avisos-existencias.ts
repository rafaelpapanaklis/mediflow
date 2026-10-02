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
//   agotado    = sin existencias          → filtro «Agotados»
//   bajo       = queda algo, ≤ el mínimo  → filtro «Stock bajo»
//   sin contar = en cero y NUNCA contado  → filtro «Sin contar» (12f, ticket 3
//                de BEVADENT: 109 artículos sembrados en 0 salían «agotados»;
//                ver sin-contar.server.ts). No es agotado: no se sabe cuánto hay.

import type { HomeAdminAlert } from "@/lib/home/types";

export interface ConteoExistencias {
  /** Artículos sin existencias (`quantity <= 0`). */
  agotados: number;
  /** Artículos con existencias, pero en el mínimo o por debajo. */
  bajos: number;
  /** Artículos en cero de los que nadie ha dicho cuánto hay (no son agotados). */
  sinContar?: number;
}

function entero(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Cuenta agotados y bajos con lo VIGENTE (H17, opción A de Rafael): a la
 * cantidad guardada (vigente + caducado) se le resta lo que hay en lotes
 * caducados, igual que hace la pantalla de Inventario. Sin lotes caducados
 * conocidos, es el conteo de siempre.
 */
export function contarExistenciasVigentes(
  items: ReadonlyArray<{ id: string; quantity: number; minQuantity: number }>,
  caducados: ReadonlyArray<{ itemId: string; remaining: number }>,
  /** Ids que nunca se contaron (`idsSinContar`): cuentan aparte, no como agotados. */
  sinContarIds: ReadonlySet<string> = new Set(),
): ConteoExistencias {
  const cad = new Map<string, number>();
  for (const c of caducados) cad.set(c.itemId, (cad.get(c.itemId) ?? 0) + Math.max(0, Number(c.remaining) || 0));
  let agotados = 0;
  let bajos = 0;
  let sinContar = 0;
  for (const i of items) {
    const q = Math.max(0, i.quantity - Math.round(cad.get(i.id) ?? 0));
    if (q <= 0) {
      if (sinContarIds.has(i.id)) sinContar++;
      else agotados++;
    } else if (q <= i.minQuantity) bajos++;
  }
  return { agotados, bajos, sinContar };
}

/**
 * Un aviso por cada cosa que pasa, cada uno con SU filtro. Primero lo
 * agotado (peligro: ya no hay), después lo bajo (alerta: hay que pedir) y al
 * final lo sin contar (informativo: falta capturar cuánto hay; nunca en rojo,
 * porque no se sabe que falte nada). Sin nada que decir, ningún aviso.
 */
export function avisosDeExistencias(conteo: ConteoExistencias): HomeAdminAlert[] {
  const agotados = entero(conteo.agotados);
  const bajos = entero(conteo.bajos);
  const sinContar = entero(conteo.sinContar);
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
  if (sinContar > 0) {
    avisos.push({
      id: "inv-uncounted",
      tone: "info",
      title: `Inventario: ${sinContar} insumo${sinContar === 1 ? "" : "s"} sin contar`,
      href: "/dashboard/inventory?filter=sin-contar",
    });
  }
  return avisos;
}

/** `?filter=…` del aviso → el filtro de la pantalla de Inventario. */
export function filtroDeInventario(param: string | null | undefined): "poco" | "sin" | "sin_contar" | "por_caducar" | "caducado" | null {
  switch (param) {
    case "low": return "poco";
    case "out": return "sin";
    case "sin-contar": return "sin_contar";
    case "por-caducar": return "por_caducar";
    case "caducado": return "caducado";
    default: return null;
  }
}

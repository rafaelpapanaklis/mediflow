// «Crear plan» desde un presupuesto ACEPTADO (ws1-t12 · P4): de cada concepto aceptado, una FILA del
// plan (antes salía un plan sin detalle, «Generado desde presupuesto P-…»). Puro.
//
// La fila copia nombre, procedimiento, dientes, cantidad y precio unitario del concepto. El descuento
// del presupuesto no va a la fila (la fila no tiene descuento): el costo del plan sigue siendo lo
// aceptado con su descuento, y el PDF enseña la diferencia como «Descuento» (texto exacto).
// La etapa numérica del presupuesto («Fase 2») se guarda en `faseNumero`.

import { leerFila, type FilaNueva } from "./items";

export interface ConceptoAceptadoDelPresupuesto {
  id: string;
  name: string;
  toothFdi: string | null;
  quantity: unknown;
  unitPrice: unknown;
  phase?: unknown;
  procedureId?: string | null;
}

export function filasDesdeConceptos(items: ConceptoAceptadoDelPresupuesto[]): Array<{ fila: FilaNueva; quoteItemId: string }> {
  const out: Array<{ fila: FilaNueva; quoteItemId: string }> = [];
  for (const it of items) {
    const base = {
      nombre: String(it.name ?? "").slice(0, 200),
      procedureId: it.procedureId ?? null,
      dientes: it.toothFdi ?? "",
      cantidad: Math.max(1, Math.floor(Number(it.quantity)) || 1),
      precio: Math.max(0, Number(it.unitPrice) || 0),
      faseNumero: it.phase == null ? null : Number(it.phase),
    };
    // Un dato viejo que hoy no pasaría (diente que no es FDI, etapa fuera de rango) no tira el concepto:
    // se quita ese dato y la fila entra igual.
    const intentos = [base, { ...base, dientes: "" }, { ...base, dientes: "", faseNumero: null }];
    for (const intento of intentos) {
      const { fila } = leerFila(intento);
      if (fila) {
        const { id: _id, ...nueva } = fila;
        out.push({ fila: nueva, quoteItemId: it.id });
        break;
      }
    }
  }
  return out;
}

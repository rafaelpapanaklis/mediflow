// ws1-t4 — «Editar» de una factura abre el EDITOR (conceptos, precios,
// descuentos, notas), no la ventana de detalle. Puro, sin React.
//
// La regla de cuándo se puede es la del servidor, no una nueva:
// PATCH /api/invoices/:id solo acepta conceptos en un BORRADOR sin dinero
// (`status: "DRAFT"`, `paid ≤ 0`) — lo vuelve a comprobar en el mismo UPDATE —
// y un CFDI vigente nunca se toca. Todo lo demás (pendiente, pagada, timbrada,
// cancelada) se VE («Ver factura»): allí quedan «Editar precio»/descuento del
// detalle donde el servidor los permite (sin pagos), como siempre.

export interface FacturaParaEditar {
  status: string;
  paid?: number | null;
  cfdiUuid?: string | null;
}

/** ¿«Editar» abre el editor? Borrador, sin pagos (ni saldo a favor aplicado) y sin CFDI. */
export function facturaEditableEnEditor(inv: FacturaParaEditar | null | undefined): boolean {
  if (!inv) return false;
  if (inv.status !== "DRAFT") return false;
  if (Number(inv.paid ?? 0) > 0) return false;
  if (inv.cfdiUuid) return false;
  return true;
}

/** Campos de la línea que el editor maneja; el resto (clave SAT, pieza, superficie…) se conserva. */
const CAMPOS_DEL_EDITOR = new Set(["description", "name", "quantity", "unitPrice", "discount", "total"]);

export interface ConceptoEditable {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  /** Lo demás que traía la línea guardada (p. ej. `code`, `toothNumber`, `surface`). */
  extra: Record<string, unknown>;
}

function n(x: unknown): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

/** Las líneas guardadas de la factura, como las pinta el editor. Mismo criterio que «Duplicar». */
export function conceptosParaEditar(items: unknown): ConceptoEditable[] {
  const lista = Array.isArray(items) ? (items as any[]) : [];
  return lista
    .map((it) => {
      const quantity = Math.max(1, Math.floor(n(it?.quantity)) || 1);
      // Facturas viejas sin unitPrice: el importe de la línea entre la cantidad.
      const unitPrice = it?.unitPrice !== undefined && it?.unitPrice !== null
        ? n(it.unitPrice)
        : Math.round((n(it?.total) / quantity) * 100) / 100;
      const extra: Record<string, unknown> = {};
      if (it && typeof it === "object") {
        for (const [k, v] of Object.entries(it)) if (!CAMPOS_DEL_EDITOR.has(k)) extra[k] = v;
      }
      return {
        name: String(it?.description ?? it?.name ?? "").trim(),
        quantity,
        unitPrice: Math.max(0, unitPrice),
        discount: Math.max(0, n(it?.discount)),
        extra,
      };
    })
    .filter((it) => it.name.length > 0);
}

/**
 * Cuerpo del PATCH. Las líneas llegan YA normalizadas por `computeTotals` (las
 * mismas que el editor enseña) con su descuento de línea ya clampeado; cada una
 * recupera sus campos extra. El total lo vuelve a calcular el servidor con los
 * impuestos que YA tiene la factura.
 */
export function cuerpoDeEdicion(p: {
  lineas: { name: string; quantity: number; unitPrice: number; discount: number; lineTotal: number; extra?: Record<string, unknown> }[];
  descuento: number;
  notas: string;
}): { items: Record<string, unknown>[]; discount: number; notes: string | null } {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    items: p.lineas.map((it) => ({
      ...(it.extra ?? {}),
      description: String(it.name).trim(),
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      ...(it.discount > 0 ? { discount: it.discount } : {}),
      total: r2(it.lineTotal),
    })),
    discount: r2(Math.max(0, p.descuento)),
    notes: p.notas.trim() ? p.notas.trim() : null,
  };
}

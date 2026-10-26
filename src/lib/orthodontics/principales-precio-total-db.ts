// ¿Cuáles de estas facturas son la factura PRINCIPAL de un caso de ortodoncia en «Precio total a
// plazos»? (decisión de Rafael, 26-oct-2026: de esas solo se debe lo vencido según su calendario).
// Lo usa `computeReceivables` (src/lib/caja.ts). Tolerante: si algo no se puede leer, conjunto
// vacío y la factura cuenta como siempre. Toda consulta con el `clinicId` de quien llama.

import { prisma } from "@/lib/prisma";
import { cargarModosDeCobro } from "./billing-mode-db";
import { normalizarOrthoBillingMode } from "./billing-mode";

export type LectorDePrincipalesPrecioTotal = (clinicId: string, invoiceIds: string[]) => Promise<Set<string>>;

export async function principalesPrecioTotal(clinicId: string, invoiceIds: string[]): Promise<Set<string>> {
  const salida = new Set<string>();
  // `clinicId` vacío no filtra nada: se corta antes de consultar.
  if (!clinicId || invoiceIds.length === 0) return salida;
  try {
    const planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, invoiceId: { in: invoiceIds }, deletedAt: null },
      select: { id: true, invoiceId: true },
    });
    if (planes.length === 0) return salida;
    // Sin la columna `billingMode` (SQL sin pegar) todo caso es «Precio total», el de siempre.
    const modos = await cargarModosDeCobro(clinicId, planes.map((p) => p.id));
    for (const p of planes) {
      if (p.invoiceId && normalizarOrthoBillingMode(modos.get(p.id)) === "PRECIO_TOTAL") salida.add(p.invoiceId);
    }
    return salida;
  } catch (e) {
    console.warn(`[ortodoncia:por-cobrar] clínica ${clinicId}: no se pudieron leer los casos; sus facturas cuentan completas.`, e);
    return new Set();
  }
}

// ¿Qué notas de cobro impiden borrar el plan? (ws1-t12 · fase 2; la regla en `borrar-plan.ts`)
//
// Cuenta toda factura NO cancelada ligada al plan: por la columna `invoices."treatmentPlanId"` (la
// nota del plan y sus adicionales), por una fila del plan (`treatment_plan_items."invoiceId"`) o por
// un presupuesto del plan (`quotes.invoiceId`: la factura «de siempre» que cobró lo aceptado, que la
// cuenta del plan también suma). Una nota cancelada no bloquea: ya no cobra nada. Sin el SQL del plan
// solo cuentan las de sus presupuestos. Toda consulta con el `clinicId` de la sesión de quien llama.
//
// `db`: la transacción de quien borra, con el plan ya BLOQUEADO (`bloquearPlan`): así «Aceptar el plan»
// en otra pestaña no puede crear la nota entre esta comprobación y el borrado.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { columnaNotaDelPlanExiste, tablaDeFilasExiste } from "./items-db";

export async function notasQueImpidenBorrar(clinicId: string, planId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string[]> {
  if (!clinicId || !planId) throw new Error("plan:borrar: clinicId o planId ausente — se corta antes de consultar");
  const ids = new Set<string>();
  const deSusPresupuestos = await db.quote.findMany({
    where: { clinicId, treatmentPlanId: planId, invoiceId: { not: null } },
    select: { invoiceId: true },
    take: 50,
  });
  for (const q of deSusPresupuestos) if (q.invoiceId) ids.add(q.invoiceId);
  if (await columnaNotaDelPlanExiste()) {
    const r = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "invoices" WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" = ${planId}`;
    for (const x of r) ids.add(x.id);
  }
  if (await tablaDeFilasExiste()) {
    const r = await db.$queryRaw<Array<{ invoiceId: string }>>`
      SELECT DISTINCT "invoiceId" FROM "treatment_plan_items"
       WHERE "clinicId" = ${clinicId} AND "planId" = ${planId} AND "invoiceId" IS NOT NULL`;
    for (const x of r) ids.add(x.invoiceId);
  }
  if (ids.size === 0) return [];
  const vivas = await db.invoice.findMany({
    where: { clinicId, id: { in: Array.from(ids) }, status: { not: "CANCELLED" } },
    select: { invoiceNumber: true },
    orderBy: { createdAt: "asc" },
  });
  return vivas.map((v) => v.invoiceNumber);
}


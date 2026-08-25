// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/realty/expenses/[id] → borra un gasto mal capturado
//
// Un gasto sí se borra (a diferencia de un pago de renta o de un depósito,
// que son dinero del inquilino): es un apunte del dueño sobre su propio
// inmueble. Aun así, se busca SIEMPRE con el accountId de la sesión.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  deleteExpense,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
} from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "expenses.manage");
  } catch {
    return realtyForbidden("expenses.manage");
  }

  try {
    await deleteExpense(ctx, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return realtyApiError(err, "expenses:delete");
  }
}

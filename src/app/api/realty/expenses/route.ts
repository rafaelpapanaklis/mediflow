// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/expenses → gastos del inmueble (predial, agua, etc.)
// POST /api/realty/expenses → registrar un gasto
//
// Esto es lo que después permite calcular la rentabilidad REAL de cada
// inmueble: sin los gastos capturados, el "rendimiento" que enseñe la
// calculadora sería la renta bruta disfrazada de utilidad.
//
// 🔴 Un gasto NO es una factura: `receiptUrl` es el comprobante que el
// dueño guarda, y este vertical no timbra nada.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  createExpense,
  listExpenses,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  type ExpenseInput,
} from "@/lib/realty/leases";
import type { RealtyExpenseKind } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set(["PREDIAL", "AGUA", "MANTENIMIENTO", "REPARACION", "OTRO"]);

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "expenses.manage");
  } catch {
    return realtyForbidden("expenses.manage");
  }

  try {
    const sp = req.nextUrl.searchParams;
    const raw = sp.get("kind") ?? "";
    const result = await listExpenses(ctx, {
      propertyId: sp.get("propertyId") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      kind: KINDS.has(raw) ? (raw as RealtyExpenseKind) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return realtyApiError(err, "expenses:list");
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "expenses.manage");
  } catch {
    return realtyForbidden("expenses.manage");
  }

  try {
    const body = await readJson(req);
    const id = await createExpense(ctx, body as unknown as ExpenseInput);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return realtyApiError(err, "expenses:create");
  }
}

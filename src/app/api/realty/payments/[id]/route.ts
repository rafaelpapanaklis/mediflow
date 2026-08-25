// ═══════════════════════════════════════════════════════════════════════
// POST   /api/realty/payments/[id] → emite (o devuelve) el folio del recibo
// DELETE /api/realty/payments/[id] → cancela un pago mal capturado
//
// 🔴 EL FOLIO SALE DEL MÁXIMO EMITIDO, NUNCA DE UN count + 1. Con un pago
// borrado o con dos recibos a la vez, count colisiona y salen dos recibos
// con el mismo número. El MAX se hace en SQL con un candado de transacción
// por cuenta — ver emitReceipt en src/lib/realty/leases.ts.
//
// Emitir es IDEMPOTENTE: si el pago ya tiene recibo, se devuelve el mismo
// folio. Un pago jamás tiene dos folios.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  deletePayment,
  emitReceipt,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
} from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    const receipt = await emitReceipt(ctx, params.id);
    return NextResponse.json({ ok: true, ...receipt });
  } catch (err) {
    return realtyApiError(err, "payments:receipt");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    await deletePayment(ctx, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return realtyApiError(err, "payments:delete");
  }
}

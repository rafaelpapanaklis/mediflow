// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/payments → el tablero de cobranza del mes
//      ?periodo=YYYY-MM     (default: el mes de hoy en la zona de la cuenta)
//      ?vencidos=1          (solo lo que tiene saldo y ya venció)
// POST /api/realty/payments → registrar un pago (admite ABONO PARCIAL)
//
// El pago parcial deja el cargo en PARCIAL con su saldo, y el semáforo
// sigue contando los días desde el vencimiento. El estado del cargo se
// RECALCULA desde la suma de sus pagos, no desde el que acaba de entrar.
//
// 🔴 Lo que se emite es un RECIBO con folio consecutivo. Ni CFDI, ni
// timbrado, ni SAT: este vertical no factura.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  getCollectionsBoard,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  registerPayment,
} from "@/lib/realty/leases";
import type { RealtyPaymentMethod } from "@/lib/realty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    const sp = req.nextUrl.searchParams;
    const board = await getCollectionsBoard(ctx, {
      periodMonth: sp.get("periodo") ?? undefined,
      onlyOverdue: sp.get("vencidos") === "1",
    });
    return NextResponse.json({ board });
  } catch (err) {
    return realtyApiError(err, "payments:board");
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    const body = await readJson(req);
    const result = await registerPayment(ctx, {
      chargeId: typeof body.chargeId === "string" ? body.chargeId : null,
      leaseId: typeof body.leaseId === "string" ? body.leaseId : null,
      amount: body.amount as number | string,
      method: body.method as RealtyPaymentMethod,
      paidAt: typeof body.paidAt === "string" ? body.paidAt : null,
      reference: typeof body.reference === "string" ? body.reference : null,
      emitReceipt: body.emitReceipt !== false,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return realtyApiError(err, "payments:create");
  }
}

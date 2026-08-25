// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/leases/[id]/inventory → los recorridos + la COMPARACIÓN
//                                          entrada contra salida
// POST /api/realty/leases/[id]/inventory → guardar un recorrido completo
//
// El recorrido es un ACTO: se camina la casa cuarto por cuarto y se firma.
// Por eso se guarda entero de una vez y volver a guardar REEMPLAZA sus
// renglones — un doble clic no deja el inventario duplicado.
//
// Las fotos NO viajan aquí: se suben antes a
// /api/realty/leases/[id]/inventory/fotos, que devuelve la RUTA del bucket
// privado. Aquí solo se guardan esas rutas.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  compareInventory,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
  upsertInventoryCheck,
  type InventoryCheckInput,
} from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    const comparison = await compareInventory(ctx, params.id);
    return NextResponse.json({ comparison });
  } catch (err) {
    return realtyApiError(err, "leases:inventory-list");
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    const body = await readJson(req);
    const checkId = typeof body.checkId === "string" && body.checkId ? body.checkId : undefined;
    const id = await upsertInventoryCheck(
      ctx,
      params.id,
      body as unknown as InventoryCheckInput,
      checkId,
    );
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return realtyApiError(err, "leases:inventory-save");
  }
}

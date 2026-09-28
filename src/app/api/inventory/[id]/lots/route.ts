// Inventario B (WS1-T5) — lotes de UN artículo: lista y alta.
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { createLot, esErrorDeLotesNoAplicados, listLotsForItem } from "@/lib/inventory/lots.server";
import { parseFechaCalendario } from "@/lib/inventory/fecha-calendario";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "inventory.view");
  if (denied) return denied;

  const item = await prisma.inventoryItem.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  if (!item) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });

  const lots = await listLotsForItem(ctx.clinicId, params.id);
  return NextResponse.json({ lots });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const item = await prisma.inventoryItem.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  if (!item) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });

  const body = await req.json();
  const quantity = Number(body.quantity);
  if (!(quantity > 0)) {
    return NextResponse.json({ error: "La cantidad del lote debe ser mayor a 0" }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    // ws1-t5 (arreglo): la caducidad es un día de calendario; se guarda
    // siempre igual (medianoche UTC de ese día), venga de aquí o de una
    // compra. Ver fecha-calendario.ts.
    const d = parseFechaCalendario(String(body.expiresAt));
    if (!d) return NextResponse.json({ error: "Fecha de caducidad inválida" }, { status: 400 });
    expiresAt = d;
  }

  try {
    const lot = await createLot({
      clinicId:       ctx.clinicId,
      itemId:         params.id,
      lotNumber:      body.lotNumber?.trim() || null,
      expiresAt,
      quantity,
      unitCost:       body.unitCost != null && body.unitCost !== "" ? Number(body.unitCost) : null,
      purchaseLineId: body.purchaseLineId?.trim() || null,
      userId:         ctx.userId,
    });
    revalidatePath("/dashboard/inventory");
    return NextResponse.json(lot, { status: 201 });
  } catch (err: any) {
    if (esErrorDeLotesNoAplicados(err)) {
      return NextResponse.json({ error: "El SQL de lotes todavía no está aplicado en esta base (sql/inventario-lotes-caducidad-t5.sql)" }, { status: 503 });
    }
    console.error("Create lot error:", err);
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}

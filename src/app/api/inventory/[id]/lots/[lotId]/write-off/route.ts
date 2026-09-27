// Inventario B (WS1-T5) — dar de baja un lote caducado (pérdida física).
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { esErrorDeLotesNoAplicados, writeOffExpiredLot } from "@/lib/inventory/lots.server";

export async function POST(req: NextRequest, { params }: { params: { id: string; lotId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const lot = await prisma.inventoryLot.findFirst({ where: { id: params.lotId, clinicId: ctx.clinicId, itemId: params.id } });
  if (!lot) return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });

  try {
    await writeOffExpiredLot({ clinicId: ctx.clinicId, lotId: params.lotId, userId: ctx.userId });
    revalidatePath("/dashboard/inventory");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (esErrorDeLotesNoAplicados(err)) {
      return NextResponse.json({ error: "El SQL de lotes todavía no está aplicado en esta base (sql/inventario-lotes-caducidad-t5.sql)" }, { status: 503 });
    }
    console.error("Write off lot error:", err);
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}

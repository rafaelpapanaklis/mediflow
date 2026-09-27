// Inventario B (WS1-T5) — "receta de materiales" de UN procedimiento del
// catálogo: qué insumos y cuánto gasta una realización.
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { deleteRecipeLine, getRecipe, upsertRecipeLine } from "@/lib/inventory/recipe.server";
import { esErrorDeLotesNoAplicados } from "@/lib/inventory/lots.server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "procedures.view");
  if (denied) return denied;

  const procedure = await prisma.procedureCatalog.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  if (!procedure) return NextResponse.json({ error: "Procedimiento no encontrado" }, { status: 404 });

  const lines = await getRecipe(ctx.clinicId, params.id);
  return NextResponse.json({ lines });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "procedures.edit");
  if (denied) return denied;

  const body = await req.json();
  const itemId   = String(body.itemId ?? "");
  const quantity = Number(body.quantity);
  if (!itemId) return NextResponse.json({ error: "Falta el insumo" }, { status: 400 });
  if (!(quantity > 0)) return NextResponse.json({ error: "La cantidad debe ser mayor a 0" }, { status: 400 });

  try {
    await upsertRecipeLine(ctx.clinicId, params.id, itemId, quantity);
    revalidatePath("/dashboard/procedures");
    const lines = await getRecipe(ctx.clinicId, params.id);
    return NextResponse.json({ lines });
  } catch (err: any) {
    if (esErrorDeLotesNoAplicados(err)) {
      return NextResponse.json({ error: "El SQL de lotes todavía no está aplicado en esta base (sql/inventario-lotes-caducidad-t5.sql)" }, { status: 503 });
    }
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.message?.includes("no encontrado") ? 404 : 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "procedures.edit");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "Falta el insumo" }, { status: 400 });

  await deleteRecipeLine(ctx.clinicId, params.id, itemId);
  revalidatePath("/dashboard/procedures");
  const lines = await getRecipe(ctx.clinicId, params.id);
  return NextResponse.json({ lines });
}

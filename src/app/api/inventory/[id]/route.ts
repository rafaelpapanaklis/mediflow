import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { obtenerInventoryItem, actualizarInventoryItem } from "@/lib/inventory/costo.server";
import { registrarHistorialInventario } from "@/lib/inventory/historial.server";
import { providerPerteneceAClinica } from "@/lib/inventory/proveedores.server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // EQ-07: este PATCH no tenía NINGUNA puerta — cualquier sesión de la clínica
  // (solo lectura incluida) cambiaba existencias, precios y nombres. Mismo
  // interruptor que el alta y la baja: "Editar inventario" (SA/ADMIN).
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const body = await req.json();
  const item = await obtenerInventoryItem({ id: params.id, clinicId: ctx.clinicId });
  if (!item) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });

  // Delta change (+ or -)
  if (body.change !== undefined) {
    const newQty  = Math.max(0, item.quantity + Number(body.change));
    const updated = await actualizarInventoryItem(params.id, { quantity: newQty, updatedAt: new Date() });
    await registrarHistorialInventario({
      itemId: params.id, clinicId: ctx.clinicId, userId: ctx.userId,
      change: Number(body.change), reason: body.reason ?? null, type: "adjust",
    });
    return NextResponse.json(updated);
  }

  // Direct quantity set
  if (body.quantity !== undefined) {
    const newQty  = Math.max(0, Number(body.quantity));
    const change  = newQty - item.quantity;
    const updated = await actualizarInventoryItem(params.id, { quantity: newQty, updatedAt: new Date() });
    if (change !== 0) {
      await registrarHistorialInventario({
        itemId: params.id, clinicId: ctx.clinicId, userId: ctx.userId,
        change, reason: "Ajuste directo", type: "adjust",
      });
    }
    return NextResponse.json(updated);
  }

  // ws1-t4: providerId es un id suelto del cliente — se valida que sea de
  // ESTA clínica antes de guardarlo (ver la nota en POST /api/inventory).
  if (body.providerId !== undefined) {
    const providerId = body.providerId || null;
    if (!(await providerPerteneceAClinica(providerId, ctx.clinicId))) {
      return NextResponse.json({ error: "Proveedor no encontrado en esta clínica" }, { status: 400 });
    }
  }

  // Update metadata fields
  const updated = await actualizarInventoryItem(params.id, {
    ...(body.name        !== undefined && { name:        body.name        }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.minQuantity !== undefined && { minQuantity: Number(body.minQuantity) }),
    ...(body.unit        !== undefined && { unit:        body.unit        }),
    ...(body.price       !== undefined && { price:       body.price !== null ? Number(body.price) : null }),
    // ws1-t4: 0 es un costo válido y se guarda tal cual — `!== undefined`,
    // no truthy (mismo cuidado que en el alta, POST /api/inventory).
    ...(body.unitCost    !== undefined && { unitCost:    body.unitCost !== null ? Number(body.unitCost) : 0 }),
    ...(body.providerId  !== undefined && { providerId:  body.providerId || null }),
    ...(body.emoji       !== undefined && { emoji:       body.emoji       }),
    updatedAt: new Date(),
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // EQ-07: "Editar inventario" (antes `isAdmin`, mismos roles por default).
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  await prisma.inventoryItem.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
  return NextResponse.json({ success: true });
}

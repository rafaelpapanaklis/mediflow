import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { listarInventario, crearInventoryItem } from "@/lib/inventory/costo.server";

// EQ-07 — ws1-t4: la página y este GET no tenían NINGUNA puerta (cualquier
// sesión de la clínica, hasta un DOCTOR sin "inventory.view", leía el
// inventario completo). "Ver inventario" ya lo tiene por default
// RECEPTIONIST/READONLY/ADMIN/SUPER_ADMIN; se lo damos también a DOCTOR
// (permissions.ts) porque el selector de insumos de una sesión de
// tratamiento (treatments-client.tsx) pega a este mismo GET.
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "inventory.view");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const items = await listarInventario({ clinicId: ctx.clinicId, category: category ?? undefined });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // EQ-07: "Editar inventario" del modal (por default SA/ADMIN, los mismos
  // que dejaba pasar el `isAdmin` que había aquí), con override incluido.
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const body = await req.json();
  if (!body.name?.trim() || !body.category?.trim()) {
    return NextResponse.json({ error: "Nombre y categoría son requeridos" }, { status: 400 });
  }

  // ws1-t4: 0 es un costo válido ("no cuesta nada") y se guarda tal cual —
  // por eso el chequeo es `!== undefined`, no truthy (el mismo bug que tenía
  // `price` aquí abajo, que convertía un 0 capturado en null).
  const item = await crearInventoryItem({
    clinicId:    ctx.clinicId,
    name:        body.name.trim(),
    description: body.description ?? null,
    category:    body.category.trim(),
    emoji:       body.emoji ?? "📦",
    quantity:    Number(body.quantity ?? 0),
    minQuantity: Number(body.minQuantity ?? 5),
    unit:        body.unit ?? "pza",
    price:       body.price !== undefined && body.price !== null && body.price !== "" ? Number(body.price) : null,
    unitCost:    body.unitCost !== undefined && body.unitCost !== null && body.unitCost !== "" ? Number(body.unitCost) : 0,
  });
  return NextResponse.json(item, { status: 201 });
}

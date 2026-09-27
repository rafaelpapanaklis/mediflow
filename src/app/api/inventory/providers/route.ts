import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  listarProveedores,
  crearProveedor,
  ProveedoresTablaFaltanteError,
} from "@/lib/inventory/proveedores.server";

// ═══════════════════════════════════════════════════════════════════
// PROVEEDORES PROPIOS de la clínica (ws1-t4) — NO el marketplace B2B.
// Mismo permiso que el resto de Inventario: "Editar inventario" para dar de
// alta uno (lo mismo que crear/editar un artículo); verlos va con
// "inventory.view" (el select del artículo y el modal de compra los listan).
// ═══════════════════════════════════════════════════════════════════

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "inventory.view");
  if (denied) return denied;

  const proveedores = await listarProveedores(ctx.clinicId);
  return NextResponse.json(proveedores);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "El nombre del proveedor es requerido" }, { status: 400 });
  }

  try {
    const proveedor = await crearProveedor({
      clinicId: ctx.clinicId,
      name:     body.name.trim(),
      rfc:      body.rfc?.trim() || null,
      contact:  body.contact?.trim() || null,
    });
    return NextResponse.json(proveedor, { status: 201 });
  } catch (e) {
    if (e instanceof ProveedoresTablaFaltanteError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  registrarCompra,
  listarCompras,
  ComprasTablaFaltanteError,
  LineaInvalidaError,
  ArticuloNoEncontradoError,
} from "@/lib/inventory/compras.server";
import { providerPerteneceAClinica } from "@/lib/inventory/proveedores.server";

// ═══════════════════════════════════════════════════════════════════
// COMPRAS / ENTRADAS de inventario (ws1-t4). "Editar inventario" — mismo
// interruptor que el alta/baja de artículo (altas, ajustes de existencias y
// precios): registrar una compra ES un alta de existencias con costo y
// proveedor.
// ═══════════════════════════════════════════════════════════════════

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFecha(raw?: string): Date | null {
  if (!raw) return new Date();
  const iso = DATE_ONLY_RE.test(raw) ? `${raw}T00:00:00.000-06:00` : raw;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "inventory.view");
  if (denied) return denied;

  const compras = await listarCompras(ctx.clinicId);
  return NextResponse.json({ compras });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
  }

  const rawLines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.map((l: any) => ({
    itemId:   String(l?.itemId ?? ""),
    quantity: Number(l?.quantity),
    unitCost: Number(l?.unitCost),
  }));
  if (lines.length === 0 || lines.some((l) => !l.itemId)) {
    return NextResponse.json({ error: "La compra necesita al menos una línea con artículo." }, { status: 400 });
  }

  const date = parseFecha(body.date);
  if (!date) return NextResponse.json({ error: "Fecha inválida (usa YYYY-MM-DD o ISO)." }, { status: 400 });

  // ws1-t4: providerId es un id suelto del cliente — se valida que sea de
  // ESTA clínica (ver la misma nota en POST /api/inventory).
  const providerId = body.providerId ? String(body.providerId) : null;
  if (!(await providerPerteneceAClinica(providerId, ctx.clinicId))) {
    return NextResponse.json({ error: "Proveedor no encontrado en esta clínica" }, { status: 400 });
  }

  try {
    const resultado = await registrarCompra({
      clinicId:       ctx.clinicId,
      providerId,
      date,
      receiptRef:     body.receiptRef?.trim() || null,
      createdById:    ctx.userId,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : null,
      lines,
    });
    return NextResponse.json(resultado, { status: resultado.yaExistia ? 200 : 201 });
  } catch (e) {
    if (e instanceof ComprasTablaFaltanteError) return NextResponse.json({ error: e.message }, { status: 503 });
    if (e instanceof LineaInvalidaError)        return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof ArticuloNoEncontradoError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("[inventory/purchases] POST error:", (e as Error)?.message ?? e);
    return NextResponse.json({ error: "Error al registrar la compra." }, { status: 500 });
  }
}

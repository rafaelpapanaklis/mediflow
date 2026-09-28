import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  subirComprobanteDeCompra,
  ComprasTablaFaltanteError,
  ComprobanteInvalidoError,
  CompraNoEncontradaError,
} from "@/lib/inventory/comprobante.server";
import { limiteSubidasPorUsuario } from "@/lib/uploads/validar-archivo";

// ═══════════════════════════════════════════════════════════════════
// COMPROBANTE de una compra como ARCHIVO (ws1-t4, ajuste 1) — foto o PDF,
// aparte del folio de texto. Mismo permiso que registrar la compra
// ("inventory.edit"): adjuntar/reemplazar el comprobante es parte de la
// misma acción de administrar la compra.
// ═══════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  if (!limiteSubidasPorUsuario(`dental:comprobante:${ctx.userId}`)) {
    return NextResponse.json({ error: "Demasiadas subidas. Espera unos minutos." }, { status: 429 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file requerido (multipart/form-data)." }, { status: 400 });
  }

  try {
    const resultado = await subirComprobanteDeCompra({ clinicId: ctx.clinicId, purchaseId: params.id, file, userId: ctx.userId });
    return NextResponse.json(resultado, { status: 201 });
  } catch (e) {
    if (e instanceof ComprasTablaFaltanteError) return NextResponse.json({ error: e.message }, { status: 503 });
    if (e instanceof ComprobanteInvalidoError)  return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof CompraNoEncontradaError)   return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("[inventory/purchases/comprobante] POST error:", (e as Error)?.message ?? e);
    return NextResponse.json({ error: "Error al subir el comprobante." }, { status: 500 });
  }
}

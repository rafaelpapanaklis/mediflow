// GET /api/invoices/[id]/permisos-cobro — qué botones de cobro puede pintar esta
// sesión en el detalle de la factura (H14, revisión final). Es solo INFORMATIVO:
// cada acción vuelve a exigir su permiso en su propio endpoint. Un doctor con
// los permisos por default veía «Registrar pago», «Marcar pagada» o «Facturar
// (CFDI)» y el servidor le contestaba 403.
//
// Multi-tenant: la factura se busca por el clinicId de la sesión.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  return NextResponse.json({
    // Registrar pago, métodos de pago y «Marcar pagada»: billing.charge.
    puedeCobrar: denyIfMissingPermission(ctx, "billing.charge") === null,
    // POST /api/cfdi exige rol administrador (requireAdmin), no una llave.
    puedeTimbrar: requireAdmin(ctx) === null,
  }, { headers: { "Cache-Control": "no-store" } });
}

// /api/invoices/[id]/link-pago — el link de Mercado Pago de una factura (ws1-t1).
//
//   GET  → 200 { disponible, link: { url, monto, venceA } | null, habiaLink, saldo, motivo, motivoTexto }
//          Solo lee. Lo usa el detalle de la factura para «ver / copiar link».
//   POST → 200 { link: { url, monto, venceA }, reutilizado }
//          | 404 | 409 { error, code } (sin Mercado Pago, sin saldo…) | 502
//          Crea el link, o devuelve el vigente si pide el mismo saldo.
//
// 🔴 El POST NO lee body: el monto es el saldo de la factura, leído en el
// servidor (src/lib/factura-mp/servicio.server.ts). Mismo criterio que
// /api/paciente/payments/checkout: la factura se busca por la clínica de la
// SESIÓN, y el importe jamás viene del cliente.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { estadoDelLink, obtenerLinkDeFactura, TEXTO_ERROR_LINK } from "@/lib/factura-mp/servicio.server";

export const dynamic = "force-dynamic";

/** La factura es de la clínica de la sesión y su paciente es visible para este usuario. */
async function comprobarFactura(
  ctx: { clinicId: string; userId: string; role: any },
  invoiceId: string,
): Promise<Response | null> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, clinicId: ctx.clinicId }, // scope multi-tenant
    select: { patientId: true },
  });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const denied = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  const bloqueo = await comprobarFactura(ctx, params.id);
  if (bloqueo) return bloqueo;

  try {
    const estado = await estadoDelLink({ clinicId: ctx.clinicId, invoiceId: params.id });
    return NextResponse.json({ ...estado, motivoTexto: estado.motivo ? TEXTO_ERROR_LINK[estado.motivo] : null });
  } catch (e) {
    console.error(`[invoices/link-pago] no se pudo leer el link (${params.id}):`, (e as Error).message);
    // Sin dato no se ofrece nada: nada de un botón que da error.
    return NextResponse.json({ disponible: false, link: null, habiaLink: false, saldo: 0, motivo: "sin_mp", motivoTexto: null });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Cada POST puede crear una preferencia en MP: barato de abusar.
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Pedirle el pago al paciente es cobrar: el mismo permiso que registrar un pago.
  const denied = denyIfMissingPermission(ctx, "billing.charge");
  if (denied) return denied;
  const bloqueo = await comprobarFactura(ctx, params.id);
  if (bloqueo) return bloqueo;

  const r = await obtenerLinkDeFactura({ clinicId: ctx.clinicId, invoiceId: params.id, userId: ctx.userId });
  if (!r.ok || !r.link) {
    const code = r.error ?? "mp_fallo";
    const status = code === "no_encontrada" ? 404 : code === "mp_fallo" ? 502 : 409;
    return NextResponse.json({ error: TEXTO_ERROR_LINK[code], code }, { status });
  }

  if (!r.reutilizado) {
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "invoice",
      entityId: params.id,
      action: "update",
      before: { paymentLink: null },
      after: { paymentLink: { via: "mercadopago", monto: r.link.monto, venceA: r.link.venceA } },
    });
  }
  return NextResponse.json({ link: r.link, reutilizado: r.reutilizado });
}

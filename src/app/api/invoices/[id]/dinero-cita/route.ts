// POST /api/invoices/[id]/dinero-cita — { decision: "a_favor" | "reembolso" | "devuelto" }
// Decidir DESPUÉS qué pasa con el dinero de una factura cuya cita se canceló
// y quedó «pendiente de decidir» (H15, opción A — ws1-t4). Solo con permiso
// de cobro. «devuelto» (ya se le devolvió al paciente: registra el reembolso
// y cancela la factura en UNA operación) pide el permiso de reembolsar, el
// mismo que /refund y /cancel. clinicId y quién, de la sesión; visibilidad
// por paciente.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { decidirDineroDeCitaCancelada, registrarDevolucionYCancelar } from "@/lib/anticipos/cita-cancelada.server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "a_favor" && decision !== "reembolso" && decision !== "devuelto") {
    return NextResponse.json({ error: "Elige «a favor», «reembolso» o «ya lo devolví»." }, { status: 400 });
  }
  const denied = denyIfMissingPermission(ctx, decision === "devuelto" ? "billing.refund" : "billing.charge");
  if (denied) return denied;

  const inv = await prisma.invoice.findFirst({ where: { id: params.id, clinicId: ctx.clinicId }, select: { patientId: true } });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const oculto = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (oculto) return oculto;
  }
  const usuario = await prisma.user.findFirst({
    where: { id: ctx.userId, clinicId: ctx.clinicId },
    select: { firstName: true, lastName: true, email: true },
  });
  const quien = usuario ? `${usuario.firstName ?? ""} ${usuario.lastName ?? ""}`.trim() || usuario.email : ctx.userId;

  const r = decision === "devuelto"
    ? await registrarDevolucionYCancelar({ clinicId: ctx.clinicId, invoiceId: params.id, userId: ctx.userId, quien })
    : await decidirDineroDeCitaCancelada({ clinicId: ctx.clinicId, invoiceId: params.id, decision, userId: ctx.userId, quien });
  if (!r.ok) return NextResponse.json({ error: r.motivo ?? "No se pudo." }, { status: 409 });
  revalidateAfter("invoices");
  return NextResponse.json({ aplicada: r.aplicada, monto: r.monto });
}

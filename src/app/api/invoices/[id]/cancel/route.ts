import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

// Multi-tenant: clinicId siempre desde la sesión, nunca del body. Mismo
// patrón que /api/invoices/[id]/route.ts.
async function getCtx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  // Incluimos role + permissionsOverride para denyIfMissingPermission.
  const select = { id: true, clinicId: true, role: true, permissionsOverride: true } as const;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true }, select });
    if (u) return { clinicId: u.clinicId, userId: u.id, role: u.role, permissionsOverride: u.permissionsOverride };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" }, select });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id, role: dbUser.role, permissionsOverride: dbUser.permissionsOverride } : null;
}

// POST /api/invoices/[id]/cancel — body { reason?: string }
// Marca la factura como CANCELLED. Solo si paid == 0 (las que tienen pagos
// requieren un reembolso primero).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Cancelar es una operación financiera sensible — la key billing.refund
  // (description "Reembolsar / cancelar") cubre ambos casos por diseño.
  const denied = denyIfMissingPermission(ctx, "billing.refund");
  if (denied) return denied;
  const { clinicId } = ctx;

  const { reason } = await req.json().catch(() => ({ reason: undefined }));

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.status === "CANCELLED") return NextResponse.json({ error: "La factura ya está cancelada" }, { status: 400 });
  if (invoice.status === "PAID") return NextResponse.json({ error: "No se puede cancelar una factura pagada — usa Reembolsar" }, { status: 400 });
  if (invoice.paid > 0) return NextResponse.json({ error: "Esta factura tiene pagos registrados — usa Reembolsar primero" }, { status: 400 });

  // Append razón a notes si se provee, así queda registro humano-legible
  // sin necesidad de schema migration. El audit log también la guarda.
  const reasonText = (reason ?? "").trim();
  const newNotes = reasonText
    ? `${invoice.notes ? invoice.notes + "\n" : ""}[CANCELADA: ${reasonText}]`
    : invoice.notes;

  await prisma.invoice.updateMany({
    where: { id: params.id, clinicId },
    data:  { status: "CANCELLED", notes: newNotes },
  });

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { status: invoice.status, notes: invoice.notes },
    after:  { status: "CANCELLED", reason: reasonText || undefined },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

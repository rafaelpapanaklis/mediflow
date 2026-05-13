import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";

async function getCtx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return { clinicId: u.clinicId, userId: u.id };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id } : null;
}

// POST /api/invoices/[id]/confirm
// Flip DRAFT → PENDING. Las facturas creadas vía autoInvoice / from-appointment
// nacen como DRAFT para permitir ajustes antes de "emitirlas". Una vez
// confirmada, ya acepta pagos vía /api/invoices/[id] (POST) y /mark-paid.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.status !== "DRAFT") {
    return NextResponse.json({ error: "Solo se pueden confirmar borradores" }, { status: 400 });
  }

  await prisma.invoice.updateMany({
    where: { id: params.id, clinicId },
    data:  { status: "PENDING" },
  });

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { status: "DRAFT" },
    after:  { status: "PENDING" },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

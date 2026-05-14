import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

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

// POST /api/invoices/[id]/edit-price — body { total?: number; discount?: number }
//
// Permite ajustar el precio total o aplicar/cambiar el descuento de una
// factura ANTES de cobrar. Solo si paid==0 y status PENDING. (PARTIAL ya
// tiene pagos parciales registrados — modificar precio rompería el balance.)
//
// Endpoint dedicado en lugar de extender el PATCH existente para no
// interferir con el flujo de items/notes/status que ya gestiona PATCH.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Editar precio/descuento es una mutación financiera admin-level.
  // RECEPTIONIST puede crear y cobrar pero no debería ajustar precios sin
  // aprobación admin — billing.edit solo viene en defaults de ADMIN/SUPER_ADMIN.
  const denied = denyIfMissingPermission(ctx, "billing.edit");
  if (denied) return denied;
  const { clinicId } = ctx;

  const body = await req.json().catch(() => ({}));
  const totalIn    = body?.total    !== undefined ? Number(body.total)    : undefined;
  const discountIn = body?.discount !== undefined ? Number(body.discount) : undefined;

  if (totalIn === undefined && discountIn === undefined) {
    return NextResponse.json({ error: "Falta total o discount" }, { status: 400 });
  }
  if (totalIn !== undefined && (!isFinite(totalIn) || totalIn < 0)) {
    return NextResponse.json({ error: "Total inválido" }, { status: 400 });
  }
  if (discountIn !== undefined && (!isFinite(discountIn) || discountIn < 0)) {
    return NextResponse.json({ error: "Descuento inválido" }, { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.paid > 0) {
    return NextResponse.json({ error: "No se puede modificar una factura con pagos registrados" }, { status: 400 });
  }
  if (invoice.status === "CANCELLED" || invoice.status === "PAID") {
    return NextResponse.json({ error: "No se puede modificar una factura cerrada" }, { status: 400 });
  }

  // Cálculo: el invoice tiene subtotal y discount → total. Mantenemos
  // coherencia recalculando lo que cambia.
  let newSubtotal = invoice.subtotal;
  let newDiscount = invoice.discount;
  let newTotal    = invoice.total;

  if (totalIn !== undefined) {
    // Si edita total directo, conservamos discount actual y derivamos subtotal.
    newTotal    = totalIn;
    newDiscount = discountIn !== undefined ? discountIn : invoice.discount;
    newSubtotal = newTotal + newDiscount;
  } else if (discountIn !== undefined) {
    // Solo discount → recalcular total = subtotal - discount.
    newDiscount = discountIn;
    if (newDiscount > invoice.subtotal) {
      return NextResponse.json({ error: "El descuento excede el subtotal" }, { status: 400 });
    }
    newTotal    = invoice.subtotal - newDiscount;
    newSubtotal = invoice.subtotal;
  }

  const newBalance = newTotal - invoice.paid;

  await prisma.invoice.updateMany({
    where: { id: params.id, clinicId },
    data: {
      subtotal: newSubtotal,
      discount: newDiscount,
      total:    newTotal,
      balance:  Math.max(0, newBalance),
    },
  });

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { subtotal: invoice.subtotal, discount: invoice.discount, total: invoice.total, balance: invoice.balance },
    after:  { subtotal: newSubtotal, discount: newDiscount, total: newTotal, balance: Math.max(0, newBalance) },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

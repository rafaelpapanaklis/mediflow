import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import {
  sumInvoiceItems, computeInvoiceTotal, round2, PRICE_ADJUST_FLAG,
} from "@/lib/invoice-totals";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
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

  // Visibilidad por paciente (barrido Ola 3): editar precio/descuento de la
  // factura de un paciente restringido exige poder verlo.
  if (invoice.patientId) {
    const visDenied = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId,
    });
    if (visDenied) return visDenied;
  }
  if (invoice.paid > 0) {
    return NextResponse.json({ error: "No se puede modificar una factura con pagos registrados" }, { status: 400 });
  }
  if (invoice.status === "CANCELLED" || invoice.status === "PAID") {
    return NextResponse.json({ error: "No se puede modificar una factura cerrada" }, { status: 400 });
  }

  // INVARIANTE: total = Σ(conceptos) − descuento (+IVA si va agregado). Antes,
  // la rama {total} escribía el total del body y "cuadraba" subtotal = total +
  // discount SIN tocar los conceptos → el CFDI (que se emite por conceptos)
  // salía por la suma vieja (caso F-000155: total $100, conceptos $3,052).
  // Ahora el nuevo precio se representa SIEMPRE contra los conceptos reales:
  // bajar precio → descuento explícito; subir precio → línea de ajuste.
  const rawItems  = Array.isArray(invoice.items) ? (invoice.items as any[]) : [];
  // Las líneas de ajuste de ediciones anteriores se descartan y recalculan.
  const baseItems = rawItems.filter((it: any) => !it?.[PRICE_ADJUST_FLAG]);
  const itemsSum  = sumInvoiceItems(baseItems);
  const taxIncluded = invoice.taxIncluded !== false;
  const taxRate     = invoice.taxRate ?? 16;

  let newItems    = baseItems;
  let newSubtotal = itemsSum;
  let newDiscount = invoice.discount;
  let newTotal    = invoice.total;

  if (totalIn !== undefined) {
    // "Editar precio" fija el total FINAL. Con IVA agregado, lo capturado es el
    // bruto: se deriva la base antes de compararla con los conceptos.
    const targetBase = taxIncluded ? round2(totalIn) : round2(totalIn / (1 + taxRate / 100));
    if (targetBase <= itemsSum) {
      newDiscount = round2(itemsSum - targetBase);
    } else {
      const delta = round2(targetBase - itemsSum);
      newItems = [...baseItems, {
        description: "Ajuste de precio",
        quantity: 1,
        unitPrice: delta,
        total: delta,
        [PRICE_ADJUST_FLAG]: true,
      }];
      newDiscount = 0;
      newSubtotal = round2(itemsSum + delta);
    }
    newTotal = computeInvoiceTotal(newSubtotal, newDiscount, taxRate, taxIncluded).total;
  } else if (discountIn !== undefined) {
    // Solo descuento → total = Σ(conceptos) − descuento. El subtotal se
    // recalcula desde los conceptos reales (sana facturas legadas desincronizadas).
    newDiscount = round2(discountIn);
    if (newDiscount > itemsSum) {
      return NextResponse.json({ error: "El descuento excede el subtotal" }, { status: 400 });
    }
    newTotal = computeInvoiceTotal(itemsSum, newDiscount, taxRate, taxIncluded).total;
  }

  const newBalance = round2(newTotal - invoice.paid);

  await prisma.invoice.updateMany({
    where: { id: params.id, clinicId },
    data: {
      items:    newItems,
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

// PUT /api/invoices/[id]/condiciones — anota el TRATO de una factura: un pago o
// a plazos (enganche, cuántos pagos, cada cuánto, primer pago) y con qué paga.
//
// Es una ruta APARTE de POST /api/invoices a propósito: crear la factura, su
// folio y su total no cambia ni una línea por esto. El popup de Nueva factura
// primero crea la factura como siempre y DESPUÉS llama aquí.
//
// ⚠️ No cobra. No toca `paid`, `balance`, `status` ni `paymentMethod` (que es lo
// que lee el timbrado para sugerir la forma de pago del CFDI). Ver
// lib/invoices/condiciones-pago-db.ts.
//
// Nunca falla en silencio: si la tabla no existe todavía (SQL sin aplicar) o la
// base no contesta, responde con error y un motivo que se le enseña a quien
// está creando el cobro.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { normalizarCondiciones } from "@/lib/quotes/condiciones-pago";
import { guardarCondicionesDeFactura } from "@/lib/invoices/condiciones-pago-db";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // El trato se escribe al crear el cobro: mismo permiso que crear la factura.
  const denied = denyIfMissingPermission(ctx, "billing.create");
  if (denied) return denied;
  if (!ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: { id: true, total: true, patientId: true },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  if (invoice.patientId) {
    const deniedPatient = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
  }

  const body = await req.json().catch(() => ({}));
  // El enganche se acota contra el total GUARDADO de la factura, no contra el
  // que diga el cliente.
  const condiciones = normalizarCondiciones(body?.condiciones, invoice.total);

  const guardado = await guardarCondicionesDeFactura(prisma, {
    invoiceId: invoice.id,
    clinicId: ctx.clinicId,
    condiciones,
  });

  if (guardado.ajena) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (guardado.sinTabla) {
    return NextResponse.json(
      {
        error: "La forma de pago no se guardó: a esta instalación le falta un paso de base de datos (sql/factura-condiciones-pago.sql). La factura sí quedó creada.",
        code: "CONDICIONES_SIN_TABLA",
      },
      { status: 409 },
    );
  }
  if (guardado.fallo) {
    return NextResponse.json(
      { error: "La forma de pago no se guardó: la base no respondió. La factura sí quedó creada.", code: "CONDICIONES_FALLO" },
      { status: 503 },
    );
  }

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "update",
    before: { condicionesPago: null },
    after: { condicionesPago: guardado.condiciones },
  });

  return NextResponse.json({ condiciones: guardado.condiciones });
}

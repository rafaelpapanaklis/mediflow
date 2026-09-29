// POST /api/invoices/[id]/anticipo/registrar — «Registrar anticipo recibido»
// (ws1-t3 fase 2): efectivo, transferencia o terminal. Recepción YA TIENE el
// dinero (lo ve en caja o en el estado de cuenta) y lo registra a mano — sin
// esperar ningún webhook.
//
// Permiso "billing.deposit.register" (o "billing.charge", que además abre
// toda la Caja) — decisión de Rafael, sep-2026: el doctor puede registrar un
// anticipo si la clínica se lo da en Equipo → Permisos, sin que eso le
// abra el resto de Caja (billing.charge sigue siendo la key amplia). Por
// default lo tienen ADMIN, SUPER_ADMIN, RECEPTIONIST y DOCTOR — ver
// ROLE_DEFAULT_PERMISSIONS en @/lib/auth/permissions.
//
// Multi-tenant: clinicId de la sesión; visibilidad por paciente antes de
// tocar nada.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingAnyPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { registrarAnticipoRecibido } from "@/lib/anticipos/panel.server";
import { esMetodoRegistroAnticipo } from "@/lib/anticipos/core";
import { revalidatePath } from "next/cache";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingAnyPermission(ctx, ["billing.deposit.register", "billing.charge"]);
  if (denied) return denied;

  const inv = await prisma.invoice.findFirst({ where: { id: params.id, clinicId: ctx.clinicId }, select: { patientId: true } });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const deniedPatient = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (deniedPatient) return deniedPatient;
  }

  const body = await req.json().catch(() => null);
  const monto = typeof body?.monto === "number" ? body.monto : NaN;
  const method = body?.method;
  if (!Number.isFinite(monto)) return NextResponse.json({ error: "El monto es obligatorio." }, { status: 400 });
  if (!esMetodoRegistroAnticipo(method)) {
    return NextResponse.json({ error: "Método de pago inválido. Usa efectivo, transferencia, débito o crédito." }, { status: 400 });
  }
  const reference = typeof body?.reference === "string" ? body.reference : undefined;
  const notes = typeof body?.notes === "string" ? body.notes : undefined;

  const r = await registrarAnticipoRecibido({ clinicId: ctx.clinicId, invoiceId: params.id, userId: ctx.userId, monto, method, reference, notes });
  if (!r.ok || !r.registrado) {
    const status = r.error === "no_encontrada" ? 404 : r.error === "referencia_requerida" || r.error === "metodo_invalido" ? 400 : 409;
    return NextResponse.json({ error: r.motivo ?? r.error ?? "No se pudo registrar el anticipo.", code: r.error }, { status });
  }

  await logMutation({
      texto: `Registró un anticipo de ${montoParaTexto(r.registrado.amount)}`,
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: params.id,
    action: "update",
    before: { anticipoRecibido: null },
    after: {
      anticipoRecibido: {
        monto: r.registrado.amount,
        method: r.registrado.method,
        reference: reference ?? null,
        citaConfirmada: r.registrado.citaConfirmada,
        anomalia: r.registrado.anomalia,
      },
    },
  });

  revalidateAfter("invoices");
  if (inv.patientId) revalidatePath(`/dashboard/patients/${inv.patientId}`);
  return NextResponse.json({ registrado: r.registrado });
}

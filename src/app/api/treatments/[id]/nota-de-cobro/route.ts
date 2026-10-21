import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { InvoiceNumberExhaustedError } from "@/lib/invoices/next-invoice-number";
import { asegurarNotaDelPlan } from "@/lib/treatments/cobro.server";
import { FilaError } from "@/lib/treatments/items-db";
import { cuerpoDeErrorDeFila } from "@/lib/treatments/errores";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ id: string }> }

/**
 * POST /api/treatments/[id]/nota-de-cobro — «Aceptar el plan» desde el panel (ws1-t12 · P6).
 *
 * Crea la nota de cobro del plan (Invoice PENDIENTE ligada por `invoices."treatmentPlanId"`, una
 * línea por fila) o le agrega las filas que aún no tienen nota. Es la misma función que corre sola al
 * aceptar el presupuesto del plan (panel o liga) y al crecer un plan aceptado; aquí sirve para un plan
 * que la clínica acepta sin presupuesto, o para reintentar. Idempotente: un segundo clic no cobra dos
 * veces ninguna fila (contesta `estado: "nada"`).
 *
 * Permisos: `treatments.edit` (es el plan) + `billing.create` (nace una factura). El doctor, solo sus
 * planes (como PATCH). Tenant y paciente: los de la sesión. Sin el SQL: `estado: "sin_sql"`, nada cambia.
 */
export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const denied = denyIfMissingPermission(ctx, "treatments.edit") ?? denyIfMissingPermission(ctx, "billing.create");
  if (denied) return denied;
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, doctorId: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const r = await asegurarNotaDelPlan({ clinicId: ctx.clinicId, planId: plan.id, userId: ctx.userId, origen: "panel" });
    if (r.estado === "creada" || r.estado === "agregada") revalidateAfter("treatments");
    return NextResponse.json(r, { status: r.estado === "creada" ? 201 : 200 });
  } catch (e) {
    if (e instanceof FilaError) return NextResponse.json(cuerpoDeErrorDeFila(e.codigo), { status: 409 });
    if (e instanceof InvoiceNumberExhaustedError) {
      return NextResponse.json({ error: "No se pudo asignar un folio a la nota. Intenta de nuevo." }, { status: 503 });
    }
    throw e;
  }
}

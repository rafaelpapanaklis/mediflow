import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { armarPresupuestoDePlan, ESTADOS_QUE_YA_CUENTAN } from "@/lib/quotes/desde-plan";
import { repoFilas } from "@/lib/treatments/items-db";
import { leerPlan } from "@/lib/treatments/leer-plan";
import { presupuestoDesdeElPlan, tarifarioDeLaClinica } from "@/lib/treatments/presentar.server";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ id: string }> }

/**
 * «Convertir en presupuesto» (ws1-t3, punto 7e del ticket 3).
 *
 *  GET  /api/treatments/[id]/presupuesto — vista previa: los conceptos que saldrían del plan (procedimiento,
 *       dientes, cantidad, precio) y, si el plan ya tiene un presupuesto vivo, cuál es. No escribe nada.
 *  POST /api/treatments/[id]/presupuesto — crea el presupuesto BORRADOR enlazado al plan
 *       (`quotes.treatmentPlanId`). Idempotente: con un presupuesto vivo del plan (borrador, presentado o
 *       aceptado) responde ese mismo con `already: true` y NO crea otro. Uno rechazado o vencido no cuenta.
 *
 * Permisos: `billing.create` (la misma llave que POST /api/quotes: lo que se crea ES un presupuesto) y
 * `treatments.view` (se lee un plan). El doctor solo ve sus planes, como en GET /api/treatments. Todo por
 * la clínica de la sesión. No hay SQL: `treatmentPlanId` ya existe en `quotes` (sin FK) y significa «el plan
 * con el que va este presupuesto»; con él puesto, un presupuesto aceptado no ofrece crear OTRO plan.
 *
 * ws1-t12: los conceptos salen del LECTOR DUAL (las filas del plan si las tiene, con precio exacto; si
 * no, su texto).
 */

async function cargarPlan(ctx: AuthContext, id: string) {
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id, clinicId: ctx.clinicId, ...(ctx.isDoctor ? { doctorId: ctx.userId } : {}) },
    select: { id: true, patientId: true, name: true, description: true, totalCost: true },
  });
  if (!plan) return { error: NextResponse.json({ error: "Plan no encontrado" }, { status: 404 }) } as const;
  const denied = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return { error: denied } as const;
  return { plan } as const;
}

async function presupuestoVivo(ctx: AuthContext, planId: string) {
  return prisma.quote.findFirst({
    where: { clinicId: ctx.clinicId, treatmentPlanId: planId, status: { in: [...ESTADOS_QUE_YA_CUENTAN] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, folio: true, status: true, total: true, title: true },
  });
}

const aDto = (q: { id: string; folio: string; status: string; total: unknown; title: string }) => ({
  id: q.id, folio: q.folio, status: q.status, total: Number(q.total) || 0, title: q.title,
});

async function permisos(ctx: AuthContext) {
  return denyIfMissingPermission(ctx, "billing.create") ?? denyIfMissingPermission(ctx, "treatments.view");
}


export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await permisos(ctx);
  if (denied) return denied;

  const r = await cargarPlan(ctx, params.id);
  if ("error" in r) return r.error;

  const [existente, procs, filas] = await Promise.all([
    presupuestoVivo(ctx, r.plan.id),
    tarifarioDeLaClinica(ctx.clinicId),
    repoFilas.leer(ctx.clinicId, r.plan.id),
  ]);
  const leido = leerPlan(r.plan, filas);
  const armado = armarPresupuestoDePlan(
    r.plan,
    procs,
    leido.fuente === "filas" ? { renglones: leido.renglones } : { textoRedondeado: leido.textoRedondeado },
  );
  return NextResponse.json({
    plan: { id: r.plan.id, name: r.plan.name },
    existente: existente ? aDto(existente) : null,
    deFilas: leido.fuente === "filas",
    ...armado,
    conceptos: armado.conceptos.map((c) => ({
      name: c.name, toothFdi: c.toothFdi ?? null, quantity: c.quantity, unitPrice: c.unitPrice,
      origen: c.origen, deTarifario: c.deTarifario, phase: c.phase ?? null,
    })),
  });
}

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await permisos(ctx);
  if (denied) return denied;

  const r = await cargarPlan(ctx, params.id);
  if ("error" in r) return r.error;

  const hecho = await presupuestoDesdeElPlan({ clinicId: ctx.clinicId, userId: ctx.userId, plan: r.plan, presentar: false });
  if (hecho.error) return NextResponse.json({ error: hecho.error.mensaje, quote: hecho.quote }, { status: hecho.error.http });
  return NextResponse.json(
    {
      already: hecho.already,
      quote: hecho.quote,
    },
    { status: hecho.already ? 200 : 201 },
  );
}

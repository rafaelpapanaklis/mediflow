// GET/POST /api/cobro-automatico/factura/[id] — el cobro automático con tarjeta
// de UNA factura a plazos (ws1-t6). Lo usa el bloque del caso de ortodoncia.
//
//   GET  → estado (y, si hay uno vivo, se pone al día con Mercado Pago). billing.view.
//   POST → { accion: "activar", correo?, treatmentPlanId? } | { accion: "pausar" | "reanudar" | "cancelar" }.
//          billing.charge: activar es pedirle un cobro al paciente.
//
// Multi-tenant: clinicId de la sesión; la factura se busca con él y la
// visibilidad del paciente se comprueba antes de tocar nada.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase } from "@/lib/validation/id";
import { activar, cambiarEstado, estadoDeFactura } from "@/lib/cobro-automatico/servicio.server";

export const dynamic = "force-dynamic";

type Ctx = NonNullable<Awaited<ReturnType<typeof getAuthContext>>>;

async function facturaVisible(ctx: Ctx, invoiceId: string): Promise<Response | null> {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, clinicId: ctx.clinicId }, select: { patientId: true } });
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
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  const oculta = await facturaVisible(ctx, params.id);
  if (oculta) return oculta;
  return NextResponse.json(await estadoDeFactura({ clinicId: ctx.clinicId, invoiceId: params.id }));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.charge");
  if (denied) return denied;
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  const oculta = await facturaVisible(ctx, params.id);
  if (oculta) return oculta;

  const body = await req.json().catch(() => null);
  const accion = body?.accion;
  let r;
  if (accion === "activar") {
    const caso = body?.treatmentPlanId;
    if (caso != null && !esIdDeLaBase(caso)) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
    r = await activar({
      clinicId: ctx.clinicId,
      invoiceId: params.id,
      userId: ctx.userId,
      correo: typeof body?.correo === "string" ? body.correo : null,
      treatmentPlanId: caso ?? null,
    });
  } else if (accion === "pausar" || accion === "reanudar" || accion === "cancelar") {
    r = await cambiarEstado({ clinicId: ctx.clinicId, invoiceId: params.id, userId: ctx.userId, accion });
  } else {
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  }
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true, cobro: r.cobro, estado: await estadoDeFactura({ clinicId: ctx.clinicId, invoiceId: params.id }) });
}

// GET/PUT /api/invoices/[id]/receptor-responsable — el responsable de pago (tutor)
// del caso de ortodoncia al que pertenece la factura, con sus datos fiscales
// para precargar el CFDI (ws1-t10, punto 9). `clinicId` de la sesión; el tutor se
// resuelve en el SERVIDOR desde la factura (el cliente nunca manda su id).
// GET: billing.view + visibilidad del paciente. PUT: solo administradores,
// igual que POST /api/cfdi (quien timbra es quien guarda los datos).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { isUsableWhereId } from "@/lib/validations";
import { leerResponsableParaCfdi, guardarFiscalesDelResponsable } from "@/lib/orthodontics/responsable-fiscal-db";

export const dynamic = "force-dynamic";

async function facturaVisible(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, id: string): Promise<Response | null> {
  const inv = await prisma.invoice.findFirst({ where: { id, clinicId: ctx.clinicId }, select: { patientId: true } });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const vis = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (vis) return vis;
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  if (!ctx.clinicId || !isUsableWhereId(params.id)) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  const no = await facturaVisible(ctx, params.id);
  if (no) return no;
  const r = await leerResponsableParaCfdi(ctx.clinicId, params.id);
  return NextResponse.json(r);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err || !ctx) return err;
  if (!ctx.clinicId || !isUsableWhereId(params.id)) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  const no = await facturaVisible(ctx, params.id);
  if (no) return no;
  const body = await req.json().catch(() => ({}));
  const r = await guardarFiscalesDelResponsable(ctx.clinicId, params.id, {
    rfc: body?.rfc, nombre: body?.nombre, regimen: body?.regimen, cp: body?.cp,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.motivo === "sin-columnas" ? "Falta aplicar sql/ortodoncia-responsable-fiscal.sql" : "Esta factura no tiene responsable de pago" }, { status: r.motivo === "sin-columnas" ? 409 : 404 });
  }
  return NextResponse.json({ ok: true });
}

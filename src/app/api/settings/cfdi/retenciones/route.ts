import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { columnaRetenciones, retencionesEncendidas, guardarRetenciones } from "@/lib/cfdi/retenciones.server";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/settings/cfdi/retenciones — ajuste por clínica «Facturar a
 * empresas con retención» (ws1-t4, vuelta 2: F-01). APAGADO por defecto.
 * Mismo permiso que los datos fiscales (settings.edit para cambiarlo); el
 * clinicId sale de la sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.view");
  if (denied) return denied;
  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { regimenFiscal: true } });
  return NextResponse.json({
    disponible: await columnaRetenciones(prisma),
    encendido: await retencionesEncendidas(prisma, ctx.clinicId),
    regimenFiscal: clinic?.regimenFiscal ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.encendido !== "boolean") {
    return NextResponse.json({ error: "Falta indicar si se enciende o se apaga." }, { status: 400 });
  }
  const antes = await retencionesEncendidas(prisma, ctx.clinicId);
  const ok = await guardarRetenciones(prisma, ctx.clinicId, body.encendido);
  if (!ok) {
    return NextResponse.json({ error: "Todavía no se puede: falta aplicar sql/ws1-t4-cfdi-retenciones.sql." }, { status: 503 });
  }
  await logMutation({
    texto: body.encendido ? "Encendió facturar a empresas con retención de ISR" : "Apagó facturar a empresas con retención de ISR",
    req, clinicId: ctx.clinicId, userId: ctx.userId,
    entityType: "clinic", entityId: ctx.clinicId, action: "update",
    before: { cfdiRetenciones: antes }, after: { cfdiRetenciones: body.encendido },
  });
  return NextResponse.json({ encendido: body.encendido });
}
